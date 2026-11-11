import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, MousePointer2, RotateCcw, ScrollText, Swords, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CameraHandInput } from '@/input/cameraHandInput';
import { InputManager } from '@/input/inputManager';
import { PointerInput } from '@/input/pointerInput';
import { TrailRenderer, applyDisplayDeadZone } from '@/render/trailRenderer';
import { FlyingSword } from '@/render/flyingSword';
import { CombatRenderer } from '@/combat/combatRenderer';
import { CombatEngine, type CombatSnapshot } from '@/combat/combatEngine';
import { createWolf } from '@/combat/wolf';
import { DEFAULT_COMBAT_CONFIG } from '@/combat/combatConfig';
import { TechniqueToast, deriveTechniqueToast, type TechniqueToastData } from '@/components/combat/TechniqueToast';
import { LifeOverlay } from '@/components/life/LifeOverlay';
import { LifeLedger } from '@/components/life/LifeLedger';
import { LifeEngine } from '@/life/lifeEngine';
import { findConstitution } from '@/life/lifeEngine';
import {
  createDeterministicDirector,
  getChapterOpening,
  getCompanionEvent,
  getJourneyGate,
} from '@/life/lifeDirector';
import { CHOICE_CONFIRM_MIN_PATH_RATIO, LIFE_ORIGINS, findTechniqueOpportunity } from '@/life/lifeConfig';
import { requestNarrative, techniqueSourceFor, type NarrativeKind } from '@/life/aiNarrative';
import {
  clearLifeState,
  loadLifeState,
  saveLifeState,
} from '@/life/lifeStorage';
import type { LifeState } from '@/life/lifeTypes';
import type { TechniqueKindId } from '@/life/lifeTypes';
import { TrialOverlay } from '@/components/combat/TrialOverlay';
import { BossOverlays } from '@/components/combat/BossOverlays';
import { StageHud } from '@/components/combat/StageHud';
import { StageDecor } from '@/components/stage/StageDecor';
import { IntroCinematic } from '@/components/stage/IntroCinematic';
import { ModeChooserDialog } from '@/components/stage/ModeChooserDialog';
import { BossIntroCinematic, RangedIntroCinematic, WolfIntroCinematic } from '@/components/stage/EnemyIntroCinematics';
import { SwordEngine } from '@/engine/swordEngine';
import {
  DEFAULT_ENGINE_CONFIG,
  type ActionState,
  type CameraRuntimeStatus,
  type InputSource,
} from '@/lib/types';
import { buildUiSnapshot, INITIAL_RUNTIME, INITIAL_UI, type UiState } from '@/lib/uiSnapshot';
import { cn, formatCoord } from '@/lib/utils';

const CAMERA_STATUS_TEXT: Record<CameraRuntimeStatus['cameraStatus'], string> = {
  idle: '未启动',
  starting: '启动中',
  running: '运行中',
  paused: '已暂停（后台）',
  stopped: '已停止',
  failed: '失败',
};

const MEDIAPIPE_STATUS_TEXT: Record<CameraRuntimeStatus['mediapipeStatus'], string> = {
  uninitialized: '未初始化',
  loading: '加载中',
  ready: '就绪',
  failed: '失败',
};

/** 视图：基础御剑试炼（人生流程经 LifeOverlay 叠加；技术验证面板折叠于诊断区） */
type View = 'trial';

/** Life 机缘式 → Combat TechniqueEngine 招式 kind（一一映射） */
const TECHNIQUE_KIND_MATCH: Record<TechniqueKindId, 'DIAGONAL_SLASH' | 'CROSS' | 'RETURN_WIND'> = {
  diagonalSlash: 'DIAGONAL_SLASH',
  cross: 'CROSS',
  returnWind: 'RETURN_WIND',
};

/** 战斗快照的空态（idle：试炼未开始），狼形复用工厂函数避免接口漂移 */
const INITIAL_COMBAT: CombatSnapshot = {
  bossGeometry: null, adds: [], practice: null,
  phase: 'idle',
  qi: 100,
  qiMax: 100,
  guardQi: 100,
  guardQiMax: 100,
  wolf: createWolf(DEFAULT_COMBAT_CONFIG.wolf),
  wolfX: DEFAULT_COMBAT_CONFIG.wolf.spawnX,
  lastStrike: null,
  prompts: [],
  exhausted: false,
  sheathed: false,
  rangedEnemy: null,
  projectiles: [],
  projectileFx: [],
  technique: {
    learned: { diagonalSlash: false, cross: false, returnWind: false },
    last: null,
    attempt: null,
    practiceAttempt: null,
  },
  techniqueFx: [],
  choiceGate: false,
  boss: null,
  encounter: null,
};

/**
 * Life 状态变化的副作用同步：choice gate 开关与存档。
 * （App 组件外定义，避免闭包漂移；全部经由回调内显式调用）
 */
function syncLifeSideEffects(
  state: LifeState,
  _ts: number,
  opts?: {
    combatEngine?: CombatEngine | null;
    lifeEngine?: LifeEngine;
    swordEngine?: SwordEngine | null;
    view?: View;
  },
): void {
  // 剑意感应：进入 SENSING_GATE 时清累计（重历/新局的旧 success 残留不得直接通关）
  if (state.phase === 'SENSING_GATE' && opts?.swordEngine) {
    opts.swordEngine.resetProgress();
  }
  const inChoice = state.phase === 'FATE_CHOICE_INTENT' || state.phase === 'FATE_CHOICE_FATE';
  const ce = opts?.combatEngine ?? null;
  if (ce) {
    if (inChoice) {
      ce.enterChoiceMode(performance.now());
    } else {
      ce.exitChoiceMode(performance.now());
    }
    // 第九阶段：进入 BOSS_GATE（或恢复存档）→ 自动开战（山魈进场带预警前摇）；
    // 失败重试由浮层「重新试炼」触发 handleStartBoss（新 battleId）。
    if (state.phase === 'BOSS_GATE' && !ce.bossActive) {
      ce.startBoss(performance.now(), { lifeId: state.lifeId, chapterInstanceId: state.chapterInstanceId });
    }
    // 离开 BOSS_GATE（重历/新局）→ 清 Boss runtime，防旧 Boss 污染下一场
    if (state.phase !== 'BOSS_GATE' && ce.bossActive) {
      ce.reset(performance.now());
    }
    if (state.phase === 'BOSS_GATE' && ce.activeBattleId) opts?.lifeEngine?.registerBossBattle(ce.activeBattleId);
    const session = opts?.lifeEngine?.getPracticeSession(_ts) ?? null;
    ce.setPracticeContext(session ? { ...session, kind: TECHNIQUE_KIND_MATCH[session.kind] } : null);
    // Life 是秘籍权限的唯一权威。
    {
      ce.replaceLearnedTechniques({
        diagonalSlash: state.techniques.learned.includes('diagonalSlash'),
        cross: state.techniques.learned.includes('cross'),
        returnWind: state.techniques.learned.includes('returnWind'),
      });
    }
  }
  // 存档：TRIAL_GATE 及之后的稳定阶段落盘（中间态不覆盖）
  if (state.profile && state.phase !== 'PROFILE_GENDER' && state.phase !== 'PROFILE_GENERATING' && state.phase !== 'PROFILE_REVIEW') {
    saveLifeState(state);
  }
}

export default function App() {
  // Life 引擎（懒创建，先于引用它的 state 初始化器声明；挂载后按用户选择恢复或新局）
  const lifeEngineRef = useRef<LifeEngine>(null as unknown as LifeEngine);
  if (!lifeEngineRef.current) lifeEngineRef.current = new LifeEngine();

  const [ui, setUi] = useState<UiState>(INITIAL_UI);
  const [starting, setStarting] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showSmooth, setShowSmooth] = useState(true);
  const [diagOpen, setDiagOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [modeChooserOpen, setModeChooserOpen] = useState(false);
  const [bossIntroOpen, setBossIntroOpen] = useState(false);
  const [rangedIntroOpen, setRangedIntroOpen] = useState(false);
  const [wolfIntroOpen, setWolfIntroOpen] = useState(false);
  // 命簿：纯 UI 开关（打开/关闭不触发 AI/Combat/输入循环）+ 持久存储可用性（一次性探测）
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerPersistent, setLedgerPersistent] = useState(true);
  const view: View = 'trial';
  const [combat, setCombat] = useState<CombatSnapshot>(INITIAL_COMBAT);
  const [life, setLife] = useState<LifeState>(() => lifeEngineRef.current.getState());
  const [toast, setToast] = useState<TechniqueToastData | null>(null);
  const rangedIntroSeenRef = useRef(false);
  const bossGateSeenRef = useRef(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const engineRef = useRef<SwordEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SwordEngine();
  // 输入层运行时状态（仅 CameraRuntimeStatus 字段；UI 计算值由渲染循环实时构建，避免初始值覆盖实时值）
  const runtimeRef = useRef<CameraRuntimeStatus>({ ...INITIAL_RUNTIME });
  // 剑尖光点上次显示位置（仅显示层 dead zone 状态，不回写任何数据流）
  const displayedTipRef = useRef<{ x: number; y: number } | null>(null);
  const modeRef = useRef<InputSource>('pointer');
  const inputManagerRef = useRef<InputManager | null>(null);
  const cameraInputRef = useRef<CameraHandInput | null>(null);
  const pointerInputRef = useRef<PointerInput | null>(null);
  const readingRef = useRef(false);
  const showRawRef = useRef(showRaw);
  const showSmoothRef = useRef(showSmooth);
  const viewRef = useRef(view);
  const combatEngineRef = useRef<CombatEngine | null>(null);
  // toast 已展示的 segmentId（同 segment 不重复弹出）
  const toastShownSegRef = useRef<number | null>(null);
  // toast 当前显示态镜像（渲染循环闭包内判定过期隐藏）
  const toastRef = useRef<TechniqueToastData | null>(null);
  // Life 阶段镜像（渲染循环判定战斗是否推进；仅 TRIAL_GATE/JOURNEY_GATE 阶段推进战斗）
  const lifePhaseRef = useRef<LifeState['phase']>(lifeEngineRef.current.getState().phase);
  // choice gate 期间：确认剑轨迹长度累计与起点
  const confirmRef = useRef<{ pathLen: number; lastX: number | null; lastY: number | null }>({
    pathLen: 0,
    lastX: null,
    lastY: null,
  });
  // 存档恢复提示（一次性）
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  // 是否存在可继续档案（首屏「继续人生」入口）
  const [hasSave, setHasSave] = useState(false);
  // AI 叙事（受控导演）：渲染文本 + 来源标记；加载中显示固定文本不阻塞
  const [narrative, setAiNarr] = useState<{
    body: string;
    companionLine: string | null;
    choiceLead: { optionId: string; text: string } | null;
    source: 'ai' | 'deterministic';
    fallbackReason: string | null;
    phase: LifeState['phase'];
    eventInstanceId: string | null;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiNarr = narrative?.eventInstanceId === (life.activeEvent?.eventInstanceId ?? null) ? narrative : null;
  // generation token：重历/新局/阶段切换后旧响应直接丢弃
  const aiTokenRef = useRef<{ aborted: boolean }>({ aborted: false });

  showRawRef.current = showRaw;
  showSmoothRef.current = showSmooth;
  viewRef.current = view;
  // toast 显示态镜像（渲染循环闭包内读取，避免陈旧闭包）
  toastRef.current = toast;
  lifePhaseRef.current = life.phase;
  readingRef.current = ledgerOpen || diagOpen || guideOpen || !introDone || modeChooserOpen || bossIntroOpen || rangedIntroOpen || wolfIntroOpen;

  useEffect(() => {
    if (!combat.rangedEnemy) {
      rangedIntroSeenRef.current = false;
      return;
    }
    if (!rangedIntroSeenRef.current && combat.rangedEnemy.state === 'ENTER') {
      rangedIntroSeenRef.current = true;
      setRangedIntroOpen(true);
    }
  }, [combat.rangedEnemy]);

  useEffect(() => {
    if (life.phase !== 'BOSS_GATE') {
      bossGateSeenRef.current = false;
      return;
    }
    if (!bossGateSeenRef.current) {
      bossGateSeenRef.current = true;
      setBossIntroOpen(true);
    }
  }, [life.phase]);

  /** AI 叙事调度：进入新章回阶段时请求一次（缓存命中零网络）；旧 token 响应丢弃。
   *  AI 只润色渲染文字，选项/flags/realm 全部来自 LifeEngine 固定权威。
   *  事件契约：带 activeEvent 的请求先 registerNarrativeRequest 换新 requestId，
   *  响应到达后 settleNarrative 落定（NARRATIVE_PENDING → READY），UI 才解锁。 */
  useEffect(() => {
    const phase = life.phase;
    let kind: NarrativeKind | null = null;
    if (phase === 'PROFILE_REVIEW') kind = { kind: 'identity' };
    else if (phase === 'CHAPTER_EVENT') kind = { kind: 'opening' };
    else if (phase === 'FATE_CHOICE_INTENT') kind = { kind: 'choice', stage: 'intent' };
    else if (phase === 'FATE_CHOICE_FATE') kind = { kind: 'choice', stage: 'fate' };
    else if (phase === 'COMPANION_EVENT') kind = { kind: 'companion' };
    else if (phase === 'CHAPTER_RESULT')
      kind = lifeEngineRef.current.getState().swordArchetype
        ? { kind: 'archetype' }
        : { kind: 'result' };
    else if (phase === 'TECHNIQUE_GATE') {
      // 当前机缘事件（activeEvent 无 → 已是过渡瞬时态，不请求）
      const tk = lifeEngineRef.current.currentTechniqueKind();
      if (tk) kind = { kind: 'technique', techniqueKind: tk };
    }
    if (!kind) { setAiLoading(false); return; }    // 新 generation token：取消/忽略上一次未完成的请求
    aiTokenRef.current.aborted = true;
    const token: { aborted: boolean } = { aborted: false };
    aiTokenRef.current = token;
    setAiLoading(true);
    let cancelled = false;
    // 事件契约：NARRATIVE_PENDING 事件换新 requestId（迟到响应只有匹配它才有写入资格）
    const le = lifeEngineRef.current;
    const ev = le.getState().activeEvent;
    const pendingEventId = kind.kind === 'technique'
      ? `ch1:technique:${kind.techniqueKind}`
      : kind.kind === 'choice'
        ? `ch1:choice:${kind.stage}`
        : kind.kind === 'companion'
          ? 'ch1:companion:meet'
          : kind.kind === 'archetype'
            ? 'ch1:archetype'
            : kind.kind === 'identity'
              ? 'profile:identity'
              : null;
    if (pendingEventId && ev && ev.eventDefinitionId === pendingEventId && ev.phase === 'NARRATIVE_PENDING') {
      le.registerNarrativeRequest(ev.eventInstanceId, performance.now());
    }
    const requestedEvent = le.getState().activeEvent;
    const requestedInstance = requestedEvent?.eventInstanceId;
    const requestedId = requestedEvent?.requestId;
    // 直接读引擎权威状态（语义 deps 才触发；避免 setLife 新对象导致的重复调度）
    void requestNarrative(le.getState(), kind, { token }).then((r) => {
      if (cancelled || token.aborted) return; // 旧响应丢弃
      // 事件契约：真实到达（AI 或 fallback）→ settleNarrative 落定（解锁选项/练习/收束）
      const curEv = le.getState().activeEvent;
      if (!curEv || curEv.eventInstanceId !== requestedInstance || curEv.requestId !== requestedId || r.requestId !== requestedId) return;
      if (curEv.phase === 'NARRATIVE_PENDING' && !le.settleNarrative(r.requestId!, performance.now())) return;
      if (curEv.phase !== 'NARRATIVE_READY' && curEv.phase !== 'CHOICE_READY') return;
      setAiNarr({ ...r, phase, eventInstanceId: curEv?.eventInstanceId ?? null });
      setAiLoading(false);
      // 第八阶段：AI 到达 → 注解命簿（只填轻量元数据；迟到/未知 runId 由引擎拒绝）
      if (phase === 'CHAPTER_RESULT') {
        le.annotateLedgerNarrative(
          le.ledgerRunId(),
          r.source,
          r.fallbackReason,
          performance.now(),
        );
      }
      // 落定/注解后同步引擎状态（存档 + choice gate 副作用）
      setLife((prev) => {
        const s = le.getState();
        return prev.phase === s.phase && prev.choiceStage === s.choiceStage ? { ...s } : prev;
      });
      syncLifeSideEffects(le.getState(), performance.now(), { combatEngine: combatEngineRef.current, lifeEngine: lifeEngineRef.current, swordEngine: engineRef.current });
    });
    return () => {
      cancelled = true;
    };
    // 语义依赖：阶段/选择步/重历次数变化才重新调度（life 对象引用不计）；
    // activeEvent.eventInstanceId：机缘三式连续事件的区分依据（同阶段逐式换请求）
  }, [life.phase, life.choiceStage, life.replayCount, life.seed, life.swordArchetype, life.activeEvent?.eventInstanceId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) combatEngineRef.current?.enterChoiceMode(performance.now());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /** 挂载：探测 localStorage 可用性（命簿持久提示；一次性，不进渲染循环） */
  useEffect(() => {
    try {
      const probe = '__jw_ledger_probe__';
      globalThis.localStorage?.setItem(probe, '1');
      globalThis.localStorage?.removeItem(probe);
      setLedgerPersistent(true);
    } catch {
      setLedgerPersistent(false);
    }
  }, []);

  /** v33 Overlay Escape 契约：Esc 只关闭当前打开的主动面板（命簿/诊断/剑谱等），不改任何 Life/Combat 状态 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 只关一个：优先最近打开的面板（诊断 > 命簿；其余 Overlay 自带 onClose 契约）
      setDiagOpen((prev) => {
        if (prev) return false;
        return prev;
      });
      setLedgerOpen((prev) => {
        if (prev) return false;
        return prev;
      });
      setGuideOpen(false);
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  /** 挂载：只探测存档，不自动恢复——首屏提供「继续人生 / 新开一局」明确入口 */
  useEffect(() => {
    const restored = loadLifeState();
    const usable =
      restored !== null &&
      restored.profile !== null &&
      restored.phase !== 'PROFILE_GENDER' &&
      restored.phase !== 'PROFILE_GENERATING' &&
      restored.phase !== 'PROFILE_REVIEW';
    if (usable) {
      setHasSave(true);
      return;
    }
    // 无档 / 中间态 / 坏档：清残档并给出可读提示（区分「无档」与「坏档」）
    try {
      const raw = globalThis.localStorage?.getItem('jianwen-jiuzhou:life:v1');
      if (raw) {
        setSaveNotice('旧档案已损坏或不兼容，已为你开启新的一局。');
        clearLifeState();
      }
    } catch {
      // localStorage 不可用：静默新局
    }
  }, []);

  /** 输入源切换：清旧 attempt/toast（不残留上一输入源的提示） */
  useEffect(() => {
    setToast(null);
    toastShownSegRef.current = null;
  }, [ui.mode]);

  /** 初始化：创建引擎与输入适配器，默认 Pointer 模式（无任何摄像头权限请求） */
  useEffect(() => {
    if (!combatEngineRef.current) combatEngineRef.current = new CombatEngine();
    const combatEngine = combatEngineRef.current;
    const onStatus = (patch: Partial<CameraRuntimeStatus>) => {
      Object.assign(runtimeRef.current, patch);
    };
    const frame = (f: { x: number; y: number; timestamp: number; actionState: ActionState; source: InputSource }) => {
      // SwordEngine：剑尖、轨迹与输入表现；CombatEngine：有效斩击、敌人与战斗状态
      const engine = engineRef.current!;
      if (readingRef.current || document.hidden) return;
      engine.pushFrame(f);
      // 命运选择期：帧照常进 SwordEngine（下半屏剑尖可见），但确认剑只累计位移
      const le = lifeEngineRef.current;
      const phase = le.getState().phase;
      if (
        (phase === 'FATE_CHOICE_INTENT' || phase === 'FATE_CHOICE_FATE') &&
        combatEngine.choiceGateActive
      ) {
        const c = confirmRef.current;
        if (f.actionState === 'ACTIVE') {
          if (c.lastX !== null && c.lastY !== null) {
            c.pathLen += Math.hypot(f.x - c.lastX, f.y - c.lastY);
          }
          c.lastX = f.x;
          c.lastY = f.y;
          // 累计位移达标且已择选项 → 一段普通出剑移动确认（不进 detector，不产生斩击/招式）
          if (
            c.pathLen >= CHOICE_CONFIRM_MIN_PATH_RATIO * (stageRef.current?.clientWidth ?? 800) &&
            le.getState().pendingChoiceId
          ) {
            const ok = le.confirmChoiceStroke(
              stageRef.current?.clientWidth ?? 800,
              c.pathLen,
              'ACTIVE',
              performance.now(),
            );
            if (ok) {
              c.pathLen = 0;
              c.lastX = null;
              c.lastY = null;
              const s = le.getState();
              setLife({ ...s });
              syncLifeSideEffects(s, f.timestamp, { combatEngine: combatEngineRef.current, lifeEngine: le, swordEngine: engineRef.current });
            }
          }
        } else {
          // SHEATHED / IDLE：清累计（收势或丢手不确认，保持选择界面）
          c.pathLen = 0;
          c.lastX = null;
          c.lastY = null;
        }
        return; // 不喂 CombatEngine：选择期间的一剑只是确认
      }
      combatEngine.onFrame(f, engine.lastSmoothedPoint);
    };
    const pointerInput = new PointerInput(frame, () => stageRef.current);
    const cameraInput = new CameraHandInput(
      videoRef.current!,
      stageRef.current!,
      frame,
      onStatus,
    );
    const manager = new InputManager();
    pointerInputRef.current = pointerInput;
    cameraInputRef.current = cameraInput;
    inputManagerRef.current = manager;
    void manager.switchTo(pointerInput);

    return () => {
      manager.stopAll();
      cameraInput.stop();
      inputManagerRef.current = null;
    };
  }, []);

  /** 渲染循环：rAF 绘制双轨迹、飞剑与战斗表现；诊断 UI 以 100ms 节流同步 */
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const renderer = new TrailRenderer();
    const combatRenderer = new CombatRenderer();
    const flyingSword = new FlyingSword();
    let raf = 0;
    let lastSync = 0;
    let lastFrameAt = performance.now();
    const fpsSamples: number[] = [];

    const frame = (now: number) => {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const engine = engineRef.current!;
        const combatEngine = combatEngineRef.current!;
        // 试炼视图：每帧推进战斗（回气、山狼、命中结算）。
        // Life 处于 TRIAL_GATE / JOURNEY_GATE / SENSING_GATE / TECHNIQUE_GATE 时推进
        //（SENSING_GATE：感应期间的剑照常计感（不确认选择）；TECHNIQUE_GATE：练习成招真实判定）；
        // JOURNEY_GATE 后自由再战；命运选择期由 choiceGate 冻结（engine 内部短路），
        // Profile/章回/结算阶段战斗不推进。
        const lp = lifePhaseRef.current;
        const practice = lp === 'TECHNIQUE_GATE' && lifeEngineRef.current.getState().activeEvent?.phase === 'NARRATIVE_READY';
        const combatAllowed = (lp === 'TRIAL_GATE' || lp === 'BOSS_GATE') && !readingRef.current && !document.hidden;
        if (combatAllowed) combatEngine.exitChoiceMode(now);
        else combatEngine.enterChoiceMode(now);
        if (combatAllowed || (practice && !readingRef.current && !document.hidden)) combatEngine.update(now, rect.width, rect.height);
        // 剑尖显示取平滑末点（贴合青白平滑轨迹线）
        const sp = engine.lastSmoothedPoint;
        let tip =
          sp && sp.a === 'ACTIVE' && sp.x >= 0 && sp.y >= 0 ? { x: sp.x, y: sp.y } : null;
        // 极小显示 dead zone（约 2 CSS px）：仅抑制剑尖光点的亚像素抖动；
        // 不影响 rawTrail/smoothedTrail 数据、有效移动计分、InputManager 协议或 SwordEngine 规则
        if (tip) {
          tip = applyDisplayDeadZone(displayedTipRef.current, tip);
          displayedTipRef.current = tip;
        } else {
          displayedTipRef.current = null;
        }
        if (viewRef.current === 'trial') {
          // 战斗渲染：山狼 + 剑气（气机不继时剑气视觉明显变弱；收势不产生攻击剑痕）
          const snap = combatEngine.getSnapshot();
          combatRenderer.render(ctx, {
            rawTrail: engine.rawTrail,
            smoothedTrail: engine.smoothedTrail,
            showRaw: showRawRef.current,
            showSmooth: showSmoothRef.current,
            tip,
            qiIntensity: combatEngine.qiIntensity,
            attacking: !snap.sheathed && snap.phase === 'fighting',
            snapshot: snap,
            now,
            stageW: rect.width,
            stageH: rect.height,
          });
        } else {
          renderer.render(ctx, {
            rawTrail: engine.rawTrail,
            smoothedTrail: engine.smoothedTrail,
            showRaw: showRawRef.current,
            showSmooth: showSmoothRef.current,
            swordTip: tip,
            now,
            trailTtlMs: DEFAULT_ENGINE_CONFIG.trailTtlMs,
          });
        }
        const dt = Math.min(64, Math.max(4, now - lastFrameAt));
        flyingSword.update(tip, now, dt);
        flyingSword.draw(ctx, now, combatEngine.qiIntensity);
      }

      lastFrameAt = now;

      // —— 剑意感应（SENSING_GATE）：SwordEngine 真实 2 秒有效移动 → 进入基础试炼 ——
      // 检测在渲染循环内（非 React 事件流）；进度 UI 由 100ms 节流的 setUi 携带。
      if (
        viewRef.current === 'trial' &&
        lifePhaseRef.current === 'SENSING_GATE' &&
        engineRef.current!.success
      ) {
        const le = lifeEngineRef.current;
        if (le.completeSensing(performance.now())) {
          const s = le.getState();
          setLife({ ...s });
          syncLifeSideEffects(s, now, { combatEngine: combatEngineRef.current, lifeEngine: le, swordEngine: engineRef.current });
        }
      }

      fpsSamples.push(now);
      while (fpsSamples.length > 0 && now - fpsSamples[0] > 1000) fpsSamples.shift();

      if (now - lastSync >= 100) {
        lastSync = now;
        // runtime 打底、引擎/渲染循环实时值覆盖：mode/actionState/effectiveMs/success/raw/smooth/renderFps
        // 永远来自实时计算，不被初始值覆盖（修复此前的状态覆盖 Bug）
        setUi(buildUiSnapshot(engineRef.current!, runtimeRef.current, modeRef.current, fpsSamples.length));
        if (viewRef.current === 'trial') {
          const ce = combatEngineRef.current!;
          const snap = ce.getSnapshot();
          setCombat(snap);
          // technique toast：真实 attempt 驱动（无 setTimeout），同 segment 只弹一次
          const t = deriveTechniqueToast(snap.technique.attempt, now);
          if (t && t.segmentId !== toastShownSegRef.current) {
            toastShownSegRef.current = t.segmentId;
            setToast(t);
          } else if (!t && toastRef.current) {
            // 过期自动隐藏（由 attempt TTL 判定）
            setToast(null);
          }
          if (lifePhaseRef.current === 'TECHNIQUE_GATE') {
            const le = lifeEngineRef.current;
            const receipt = ce.getPracticeReceipt();
            const kind = le.currentTechniqueKind();
            if (receipt && kind && receipt.kind === TECHNIQUE_KIND_MATCH[kind]) {
              const result = le.acceptPracticeReceipt({ ...receipt, kind }, now);
              if (result) {
                const state = le.getState();
                setLife({ ...state });
                syncLifeSideEffects(state, now, { combatEngine: ce, lifeEngine: le, swordEngine: engineRef.current });
              }
            }
          }
          // 试炼通过 → 进入第一剑·择意（一次性；TRIAL_GATE 阶段检测）
          if (snap.phase === 'won' && lifePhaseRef.current === 'TRIAL_GATE') {
            const le = lifeEngineRef.current;
            if (le.reportTrialResult(true, now) || le.getState().phase === 'TRIAL_GATE') {
              le.beginFirstChoice(now);
              // won→choice：清旧 attempt/toast（旧局提示不残留）
              toastShownSegRef.current = null;
              setToast(null);
              const s = le.getState();
              setLife({ ...s });
              syncLifeSideEffects(s, now, { combatEngine: ce, lifeEngine: le, swordEngine: engineRef.current });
            }
          }
          // 第九阶段：Boss 终局（一次性；幂等由 LifeEngine 保证，重复/迟到 victory 不二次写）
          if (lifePhaseRef.current === 'BOSS_GATE' && (snap.phase === 'won' || snap.phase === 'lost')) {
            const le = lifeEngineRef.current;
            const summary = ce.getBattleSummary();
            if (summary) {
              if (snap.phase === 'won') {
                if (le.reportBossVictory(summary, now)) {
                  toastShownSegRef.current = null;
                  setToast(null);
                  const s = le.getState();
                  setLife({ ...s });
                  syncLifeSideEffects(s, now, { combatEngine: ce, lifeEngine: le, swordEngine: engineRef.current });
                }
              } else if (le.reportBossDefeat(summary, now)) {
                // 失败：只记战斗摘要（可重试），身份/选择/命簿不动
                const s = le.getState();
                setLife({ ...s });
              }
            }
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 启用摄像头（用户点击后才请求权限）；失败保留真实错误与 Pointer 入口，不自动切换 */
  const handleEnableCamera = useCallback(async () => {
    const manager = inputManagerRef.current;
    const cameraInput = cameraInputRef.current;
    if (!manager || !cameraInput || starting || cameraInput.isRunning) return;
    setStarting(true);
    modeRef.current = 'camera';
    try {
      await manager.switchTo(cameraInput);
      if (manager.activeSource === 'camera') engineRef.current!.resetAll();
    } catch (err) {
      // 保留真实失败原因供诊断面板持续显示，不覆盖（由输入层自行上报 failed 状态）
      if (modeRef.current === 'camera') runtimeRef.current.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      setStarting(false);
    }
  }, [starting]);

  /** 切换至 Pointer 模式：立即释放摄像头全部资源 */
  const handleSwitchToPointer = useCallback(async () => {
    const manager = inputManagerRef.current;
    const pointerInput = pointerInputRef.current;
    if (!manager || !pointerInput || modeRef.current === 'pointer') return;
    modeRef.current = 'pointer';
    setStarting(false);
    await manager.switchTo(pointerInput);
    engineRef.current!.resetAll();
  }, []);

  /** 开始/重新试炼：重置战斗状态（剑心破碎后的「重新试炼」同此入口）。
   *  只清 Combat runtime 与 Technique 临时反馈，不动已确认的人生档案。 */
  const handleStartTrial = useCallback(() => {
    if (lifeEngineRef.current.isBossGate()) {
      const state = lifeEngineRef.current.getState();
      const ce = combatEngineRef.current;
      ce?.startBoss(performance.now(), { lifeId: state.lifeId, chapterInstanceId: state.chapterInstanceId });
      if (ce?.activeBattleId) lifeEngineRef.current.registerBossBattle(ce.activeBattleId);
    } else if (lifeEngineRef.current.getState().phase === 'TRIAL_GATE') {
      combatEngineRef.current?.start(performance.now());
      setWolfIntroOpen(true);
    }
    toastShownSegRef.current = null;
    setToast(null);
  }, []);

  /** 第九阶段：出剑迎魈 —— 只重置 Boss encounter（新 battleId），不动人生上下文 */
  const handleStartBoss = useCallback(() => {
    const ce = combatEngineRef.current;
    if (!ce) return;
    const state = lifeEngineRef.current.getState();
    ce.startBoss(performance.now(), { lifeId: state.lifeId, chapterInstanceId: state.chapterInstanceId });
    if (ce.activeBattleId) lifeEngineRef.current.registerBossBattle(ce.activeBattleId);
    setBossIntroOpen(true);
    toastShownSegRef.current = null;
    setToast(null);
  }, []);

  const handleIntroComplete = useCallback(() => {
    setIntroDone(true);
    setModeChooserOpen(true);
  }, []);
  const handleRangedIntroComplete = useCallback(() => setRangedIntroOpen(false), []);
  const handleWolfIntroComplete = useCallback(() => setWolfIntroOpen(false), []);
  const handleBossIntroComplete = useCallback(() => setBossIntroOpen(false), []);

  /** Life 状态统一提交：setState + 副作用（gate/存档） */
  const commitLife = useCallback((s: LifeState) => {
    setLife({ ...s });
    syncLifeSideEffects(s, performance.now(), { combatEngine: combatEngineRef.current, lifeEngine: lifeEngineRef.current, swordEngine: engineRef.current });
  }, []);

  const handleSelectGender = useCallback(
    (g: 'male' | 'female') => {
      const le = lifeEngineRef.current;
      if (le.selectGender(g, performance.now())) commitLife(le.getState());
    },
    [commitLife],
  );

  const handleGenerate = useCallback(() => {
    const le = lifeEngineRef.current;
    if (le.generateIdentity(performance.now())) commitLife(le.getState());
  }, [commitLife]);

  const handleRegenerate = useCallback(() => {
    const le = lifeEngineRef.current;
    // v33：身份正文落定后才可重生成（PENDING 期间不重复生成、不打断落字）
    const ev = le.getState().activeEvent;
    if (ev && ev.eventDefinitionId === 'profile:identity' && ev.phase !== 'NARRATIVE_READY') return;
    if (le.regenerateIdentity(performance.now())) commitLife(le.getState());
  }, [commitLife]);

  const handleConfirmProfile = useCallback(() => {
    const le = lifeEngineRef.current;
    // v33 AI-FIRST 门：正文未落定不可确认（引擎已挡；App 层再挡防止无效点击）
    const ev = le.getState().activeEvent;
    if (!(ev && ev.eventDefinitionId === 'profile:identity' && ev.phase === 'NARRATIVE_READY')) return;
    if (le.confirmProfile(performance.now())) {
      // 身份事件 FINALIZED；清旧叙事避免闪现
      setAiNarr(null);
      setAiLoading(false);
      commitLife(le.getState());
    }
  }, [commitLife]);

  /** v33：领受剑谱（OPPORTUNITY_AVAILABLE → MANUAL_RECEIVED；叙事落定后才可点） */
  const handleAcknowledgeManual = useCallback(() => {
    const le = lifeEngineRef.current;
    const kind = le.currentTechniqueKind();
    if (!kind) return;
    const now = performance.now();
    if (le.acknowledgeTechniqueManual(kind, now)) {
      commitLife(le.getState());
      le.beginTechniquePractice(kind, now);
      commitLife(le.getState());
    }
  }, [commitLife]);

  const handleSelectOption = useCallback(
    (id: string) => {
      const le = lifeEngineRef.current;
      if (le.selectOption(id, performance.now())) {
        // 重置确认剑累计（改选后重新累计）
        confirmRef.current = { pathLen: 0, lastX: null, lastY: null };
        setLife({ ...le.getState() });
      }
    },
    [],
  );

  const handleRespondCompanion = useCallback(
    (r: 'warm' | 'reserved' | 'skip') => {
      const le = lifeEngineRef.current;
      if (le.respondCompanion(r, performance.now())) commitLife(le.getState());
    },
    [commitLife],
  );

  const handleEnterJourney = useCallback(() => {
    const le = lifeEngineRef.current;
    if (le.enterJourney(performance.now())) commitLife(le.getState());
  }, [commitLife]);

  /** 重新历练本章：重放人生第一章（≠战斗「重新试炼」；保留身份与永久记录） */
  const handleReplayChapter = useCallback(() => {
    const le = lifeEngineRef.current;
    if (le.replayChapter(performance.now())) {
      // 旧 AI 请求作废 + 清空当前 AI 文案（重历后按新 replayCount 重新调度）
      aiTokenRef.current.aborted = true;
      setAiNarr(null);
      setAiLoading(false);
      confirmRef.current = { pathLen: 0, lastX: null, lastY: null };
      commitLife(le.getState());
      // 战斗单次重开（不产生第二个 Combat 循环）
      combatEngineRef.current?.reset(performance.now());
      setToast(null);
      toastShownSegRef.current = null;
    }
  }, [commitLife]);

  const handleContinueLife = useCallback(() => {
    const restored = loadLifeState();
    if (restored) {
      lifeEngineRef.current.restore(restored);
      const kind = lifeEngineRef.current.currentTechniqueKind();
      if (kind && restored.techniques.stages[kind] === 'MANUAL_RECEIVED') lifeEngineRef.current.beginTechniquePractice(kind, performance.now());
      aiTokenRef.current.aborted = true;
      setAiNarr(null);
      setAiLoading(false);
      setHasSave(true);
      commitLife(restored);
    }
  }, [commitLife]);

  const handleNewLife = useCallback(() => {
    clearLifeState();
    const le = lifeEngineRef.current;
    le.resetLife(performance.now());
    aiTokenRef.current.aborted = true;
    setAiNarr(null);
    setAiLoading(false);
    setHasSave(false);
    setSaveNotice(null);
    setLedgerOpen(false);
    setLife({ ...le.getState() });
    // 战斗归零（新局无残留；start 后 phase=fighting 但 Life 未到 TRIAL_GATE，
    // 渲染循环只在 trial 视图 update —— 下方 LifeOverlay 盖住舞台，且 Life 阶段不结算人生）
    combatEngineRef.current?.reset(performance.now());
    combatEngineRef.current?.replaceLearnedTechniques({ diagonalSlash: false, cross: false, returnWind: false });
    engineRef.current?.resetAll();
    setToast(null);
    toastShownSegRef.current = null;
  }, []);

  /** 身份卡引言：AI 只润色已生成的身份事实（name/出身/体质仍来自引擎权威） */
  const identityNarrative = useMemo(() => {
    if (life.phase !== 'PROFILE_REVIEW' || !aiNarr || aiNarr.phase !== 'PROFILE_REVIEW') return null;
    return aiNarr.body ? aiNarr.body : null;
  }, [life.phase, aiNarr]);

  // —— Life 派生数据（导演只做数据分发；确认提示由输入状态派生）——
  const director = useMemo(() => createDeterministicDirector(), []);
  const lifeChoiceEvent = useMemo(() => {
    if (life.phase === 'FATE_CHOICE_INTENT' || life.phase === 'FATE_CHOICE_FATE') {
      const base = director.getChoiceEvent(life);
      if (aiNarr?.phase === life.phase && aiNarr.body) {
        // AI 只提供事件正文、燕迟一句与引导语；三选项（id/title/shortText/后果）永不来自模型。
        // choiceLead 收口：只能是固定 optionId（须属于当前选项池）或 null——
        // 任意字符串引导已在 schema 校验拒绝，此处只对合法 optionId 显示其 text。
        const cl = aiNarr.choiceLead;
        const leadText =
          cl && base.options.some((o) => o.id === cl.optionId) ? cl.text : null;
        const yanchi = aiNarr.companionLine ? `\n燕迟：「${aiNarr.companionLine}」` : '';
        return {
          ...base,
          text: aiNarr.body + yanchi + (leadText ? `\n${leadText}` : ''),
        };
      }
      return base;
    }
    return null;
  }, [life, director, aiNarr]);
  const companionText = useMemo(() => {
    if (life.phase !== 'COMPANION_EVENT') return null;
    const base = getCompanionEvent();
    if (aiNarr?.phase === 'COMPANION_EVENT' && aiNarr.body) {
      const yanchi = aiNarr.companionLine ? `\n燕迟：「${aiNarr.companionLine}」` : '';
      return { title: base.title, text: aiNarr.body + yanchi };
    }
    return base;
  }, [life.phase, aiNarr]);
  const chapterResult = useMemo(() => {
    if (life.phase !== 'CHAPTER_RESULT') return null;
    const base = director.getChapterResult(life);
    // 第九阶段：剑道初相（程序确定）+ Boss 战摘要行（真实统计）
    const arch = life.swordArchetype;
    const bs = life.lastBattleSummary;
    const lines = [...base.lines];
    if (arch) {
      lines.push(
        `剑道初相 · ${arch.title} —— 依此役实录判定（准 ${bs?.accuracyScore ?? 0} · 稳 ${bs?.stabilityScore ?? 0} · 均速 ${bs?.averageSpeed ?? 0}）`,
      );
      lines.push(
        `赤瞳山魈之战 —— ${Math.round((bs?.duration ?? 0) / 1000)} 秒 · 有效之剑 ${bs?.slashCount ?? 0} 次 · 格挡 ${bs?.blocks ?? 0} · 破势 ${bs?.interrupts ?? 0} · 斩弹 ${bs?.projectilesCut ?? 0}`,
      );
    }
    if (aiNarr?.phase === 'CHAPTER_RESULT' && aiNarr.body) {
      return { title: base.title, lines: [...lines, aiNarr.body] };
    }
    return { title: base.title, lines };
  }, [life, director, aiNarr]);
  const opening = useMemo(() => {
    if (life.phase !== 'CHAPTER_EVENT') return null;
    const base = getChapterOpening(life);
    // AI 导演文案（阶段匹配才覆盖渲染文本；引擎状态永不使用 AI 文本）
    if (aiNarr?.phase === 'CHAPTER_EVENT' && aiNarr.body) {
      return { title: base.title, text: aiNarr.body };
    }
    return base;
  }, [life, aiNarr]);
  const journeyText = useMemo(
    () => (life.phase === 'JOURNEY_GATE' ? getJourneyGate() : null),
    [life.phase],
  );
  // 剑意感应进度（SENSING_GATE：来自 SwordEngine 真实有效移动，非 React 状态）
  const sensingProgress = Math.min(
    1,
    ui.effectiveMs / DEFAULT_ENGINE_CONFIG.targetEffectiveMs,
  );
  // 剑道机缘（TECHNIQUE_GATE 当前式：固定事实 + AI/固定导演叙事 + 已悟列表）
  const techniqueEvent = useMemo(() => {
    if (life.phase !== 'TECHNIQUE_GATE') return null;
    const kind = lifeEngineRef.current.currentTechniqueKind();
    if (!kind) return null;
    const def = findTechniqueOpportunity(kind);
    const ev = life.activeEvent;
    return {
      name: def.name,
      source: techniqueSourceFor(life, kind),
      teachingText: life.companionState.skipped ? '你独行山道，在桦皮剑谱末页找到回旋的剑路。依着旁注，剑走一圈，复归原处。' : def.teachingText,
      practiceHint: def.practiceHint,
      learnedNames: life.techniques.learned.map((k) => findTechniqueOpportunity(k).name),
      ready: ev?.phase === 'NARRATIVE_READY' && !aiLoading,
      body: aiNarr?.phase === 'TECHNIQUE_GATE' && aiNarr.body ? aiNarr.body : null,
      stage: life.techniques.stages[kind],
      practiceProgress: {
        done: life.techniques.successfulPracticeCount[kind],
        required: life.techniques.requiredSuccesses[kind],
      },
      kind,
    };
  }, [life, aiNarr, aiLoading]);
  const confirmHint: 'idle' | 'await-stroke' | 'sheathed' =
    ui.actionState === 'SHEATHED' ? 'sheathed' : 'idle';

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-[#071012] text-[#e7eee9]">
      <div
        ref={stageRef}
        className="relative h-full w-full touch-none select-none overflow-hidden bg-[hsl(var(--arena-bg))]"
      >
            <div className="pointer-events-none absolute bottom-5 left-5 z-20 flex items-center gap-2 opacity-70">
              <span className="ink-seal flex size-8 items-center justify-center rounded-sm text-sm">剑</span>
              <span><strong className="font-display text-lg font-normal tracking-[.22em] text-[#e8dfcf]">剑问九州</strong><small className="ml-3 hidden text-[9px] tracking-[.28em] text-[#9ab4a8]/55 sm:inline">雾岭 · 第一章</small></span>
            </div>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-55 grayscale-[15%] sepia-[10%] saturate-[70%] contrast-[1.06]"
            />
            <StageDecor />
            <canvas ref={canvasRef} className="absolute inset-0 z-[2] h-full w-full" />
            {(life.phase === 'TRIAL_GATE' || life.phase === 'TECHNIQUE_GATE' || life.phase === 'BOSS_GATE') && (
              <StageHud snapshot={combat} now={performance.now()} />
            )}

            {view === 'trial' && life.phase === 'TRIAL_GATE' && (
              <TrialOverlay phase={combat.phase} onStart={handleStartTrial} />
            )}

            {/* 第九阶段：Boss 浮层（开始/失败重试；won 由 LifeOverlay CHAPTER_RESULT 结算） */}
            {view === 'trial' && life.phase === 'BOSS_GATE' && (
              <BossOverlays
                phase={combat.phase}
                onStart={handleStartBoss}
                onRetry={handleStartBoss}
              />
            )}

            {/* 第四阶段遗留补足：招式对应短暂提示（attempt 驱动，不遮挡 HUD）。
                战斗结束/选择 gate/收势时不残留 */}
            {view === 'trial' && combat.phase === 'fighting' && !combat.choiceGate && !combat.sheathed && (
              <TechniqueToast toast={toast} />
            )}

            {/* 第五阶段：人生开局/第一章选择浮层（上半屏，下半屏御剑照常） */}
            {view === 'trial' && (
              <LifeOverlay
                state={life}
                profile={life.profile}
                origin={LIFE_ORIGINS.find((o) => o.id === life.profile?.originId)}
                constitution={findConstitution(life.profile?.constitutionId)}
                event={lifeChoiceEvent}
                pendingChoiceId={life.pendingChoiceId}
                companionText={companionText}
                chapterResult={chapterResult}
                opening={opening}
                journey={journeyText}
                sensingProgress={sensingProgress}
                techniqueEvent={techniqueEvent}
                onAcknowledgeManual={handleAcknowledgeManual}
                onSelectGender={handleSelectGender}
                onGenerate={handleGenerate}
                onRegenerate={handleRegenerate}
                onConfirmProfile={handleConfirmProfile}
                onSelectOption={handleSelectOption}
                onContinueChoice={() => { const le = lifeEngineRef.current; if (le.continueChoiceNarrative(performance.now())) commitLife(le.getState()); }}
                onRespondCompanion={handleRespondCompanion}
                onEnterJourney={handleEnterJourney}
                onReplayChapter={handleReplayChapter}
                onContinue={handleContinueLife}
                onNewLife={handleNewLife}
                hasSave={hasSave}
                saveNotice={saveNotice}
                confirmHint={confirmHint}
                aiLoading={life.activeEvent?.phase === 'NARRATIVE_PENDING' || aiLoading}
                aiSource={aiNarr?.phase === life.phase ? aiNarr.source : null}
                aiFallbackReason={aiNarr?.phase === life.phase ? aiNarr.fallbackReason : null}
                identityNarrative={identityNarrative}
                onOpenLedger={() => setLedgerOpen(true)}
              />
            )}

            {/* 第八阶段：命簿（长期人生档案）—— 纯查看面板，不触任何循环 */}
            {view === 'trial' && (
              <LifeLedger
                open={ledgerOpen}
                onClose={() => setLedgerOpen(false)}
                state={life}
                persistent={ledgerPersistent}
              />
            )}
            <div data-ui-interactive className="pointer-events-auto absolute right-3 top-3 z-30 flex items-center gap-1.5 md:right-5 md:top-5">
              <Button variant="arena" size="sm" className="hud-panel h-8 border-[#9fd8c8]/20 px-2.5 text-[11px] text-[#cdefe8]/70" onClick={() => setGuideOpen(true)}>
                <Swords className="size-3.5" /> 执剑
              </Button>
              <Button variant="arena" size="sm" className="hud-panel h-8 border-[#9fd8c8]/20 px-2.5 text-[11px] text-[#cdefe8]/75" onClick={() => setLedgerOpen(true)}>
                <ScrollText className="size-3.5" /> 命簿
              </Button>
              <Button
                variant="arena"
                size="sm"
                className={cn('hud-panel h-8 border-[#9fd8c8]/20 px-2.5 text-[11px]', ui.mode === 'camera' ? 'text-[#cdefe8]' : 'text-[#9ab4a8]/70')}
                onClick={() => void handleEnableCamera()}
                disabled={starting || (ui.mode === 'camera' && cameraInputRef.current?.isRunning === true)}
              >
                <Camera className="size-3.5" /> {starting ? '启镜中…' : '真人入画'}
              </Button>
              <Button
                variant="arena"
                size="sm"
                className={cn('hud-panel h-8 border-[#9fd8c8]/20 px-2.5 text-[11px]', ui.mode === 'pointer' ? 'text-[#cdefe8]' : 'text-[#9ab4a8]/70')}
                onClick={() => void handleSwitchToPointer()}
              >
                <MousePointer2 className="size-3.5" />
                {starting ? '暂以指代剑' : '指针模式'}
              </Button>
            </div>

            {guideOpen && (
              <div data-ui-interactive className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]">
                <section data-ui-interactive role="dialog" aria-label="执剑之法" className="scroll-ink anim-unfurl pointer-events-auto relative w-full max-w-lg rounded-md p-6">
                  <div className="scroll-rod absolute inset-x-[-8px] top-0" />
                  <div className="flex items-center justify-between"><h2 className="font-display text-xl tracking-[.25em] text-[#e8dfcf]">执剑之法</h2><button type="button" onClick={() => setGuideOpen(false)} aria-label="关闭执剑之法"><X className="size-4" /></button></div>
                  <div className="mt-4 grid gap-3 text-sm leading-6 text-[#cdefe8]/75 sm:grid-cols-2">
                    <p><strong className="block font-normal text-[#dcb976]">真人入画</strong>张手出剑，握拳收势；剑随食指而行。</p>
                    <p><strong className="block font-normal text-[#dcb976]">指代剑</strong>按住拖动出剑，松开即收势回气。</p>
                    <p><strong className="block font-normal text-[#dcb976]">快 · 准 · 稳</strong>速度、命中位置与剑路稳定共同决定每一击。</p>
                    <p><strong className="block font-normal text-[#dcb976]">护剑</strong>敌袭将至时收势，以气机格挡并恢复剑势。</p>
                  </div>
                  <div className="mt-4 border-t border-[#cdefe8]/10 pt-3 text-xs text-[#cdefe8]/55">已悟剑式会显示在舞台下方；冷却期间签条转暗。</div>
                  <div className="scroll-rod absolute inset-x-[-8px] bottom-0" />
                </section>
              </div>
            )}

            {wolfIntroOpen && <WolfIntroCinematic onComplete={handleWolfIntroComplete} />}
            {rangedIntroOpen && <RangedIntroCinematic onComplete={handleRangedIntroComplete} />}
            {bossIntroOpen && <BossIntroCinematic onComplete={handleBossIntroComplete} />}
            {!introDone && <IntroCinematic onComplete={handleIntroComplete} />}
            {introDone && modeChooserOpen && (
              <ModeChooserDialog
                starting={starting}
                onCamera={() => { void handleEnableCamera().finally(() => setModeChooserOpen(false)); }}
                onPointer={() => { void handleSwitchToPointer().finally(() => setModeChooserOpen(false)); }}
              />
            )}

            <div data-ui-interactive className="pointer-events-auto absolute bottom-4 right-4 z-30">
            <button
              type="button"
              className="hud-panel flex size-9 items-center justify-center rounded-full font-display text-xs text-[#9ab4a8]/55 transition hover:text-[#cdefe8]"
              onClick={() => setDiagOpen((v) => !v)}
              aria-expanded={diagOpen}
              aria-label="诊断"
            >
              診
            </button>
            {diagOpen && (
              <section className="scroll-ink absolute bottom-12 right-0 w-72 rounded-md p-4 text-xs">
                <div className="mb-3 flex items-center justify-between"><h2 className="font-display tracking-[.2em] text-[#d9eee8]">剑境诊断</h2><button type="button" onClick={() => setDiagOpen(false)} aria-label="关闭诊断"><X className="size-4" /></button></div>
                <div className="mb-3 flex flex-wrap gap-3 text-[#cdefe8]/65">
                  <label className="flex items-center gap-2"><Switch checked={showRaw} onCheckedChange={setShowRaw} aria-label="显示原始轨迹" />原始轨迹</label>
                  <label className="flex items-center gap-2"><Switch checked={showSmooth} onCheckedChange={setShowSmooth} aria-label="显示平滑轨迹" />平滑轨迹</label>
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-[#cdefe8]/10 pt-3 font-mono text-[10px]">
                <DiagRow label="输入模式" value={ui.mode === 'camera' ? 'camera' : 'pointer'} />
                <DiagRow label="摄像头状态" value={CAMERA_STATUS_TEXT[ui.cameraStatus]} />
                <DiagRow label="MediaPipe" value={MEDIAPIPE_STATUS_TEXT[ui.mediapipeStatus]} />
                <DiagRow label="单手检测" value={ui.handDetected ? '是' : '否'} />
                <DiagRow label="actionState" value={ui.actionState} />
                <DiagRow
                  label="有效移动"
                  value={`${(ui.effectiveMs / 1000).toFixed(2)} / 2.00 s`}
                />
                <DiagRow label="检测 FPS" value={String(ui.detectionFps)} />
                <DiagRow label="渲染 FPS" value={String(ui.renderFps)} />
                <DiagRow
                  label="rawX / rawY"
                  value={`${formatCoord(ui.raw?.x ?? null)} / ${formatCoord(ui.raw?.y ?? null)}`}
                />
                <DiagRow
                  label="smoothX / smoothY"
                  value={`${formatCoord(ui.smooth?.x ?? null)} / ${formatCoord(ui.smooth?.y ?? null)}`}
                />
                <DiagRow
                  label="推理耗时"
                  value={ui.inferenceMs === null ? '—' : `${ui.inferenceMs.toFixed(1)} ms`}
                />
                <DiagRow label="最后错误" value={ui.lastError ?? '—'} error={!!ui.lastError} />
                </dl>
                {life.phase === 'TRIAL_GATE' && <Button variant="arena" size="sm" className="mt-3 w-full" onClick={handleStartTrial}><RotateCcw className="size-3.5" />重新试炼</Button>}
              </section>
            )}
            </div>
      </div>
    </main>
  );
}

function DiagRow({ label, value, error }: { label: string; value: string; error?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('truncate tabular-nums', error ? 'text-destructive' : 'text-foreground')} title={value}>
        {value}
      </dd>
    </>
  );
}
