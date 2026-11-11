/**
 * 第五阶段确定性事件导演：固定世界数据上的分发层。
 * 职责：按当前 LifeState 返回经类型校验的事件/选项/反馈文案；
 * source 固定为 'deterministic'，为未来 AI 适配器保留接口形状，
 * 但 AI 输出永远不允许写 HP/qi/境界/技能/掉落/敌人/规则——数值一律来自配置表。
 */
import {
  CHAPTER_ONE_TITLE,
  CHAPTER_RESULT_TITLE,
  CHAPTER_ONE_OPENING,
  COMPANION,
  COMPANION_TITLE,
  INTENT_OPTIONS,
  FATE_OPTIONS,
  JOURNEY_GATE_TITLE,
  buildIntentEvent,
  buildFateEvent,
} from './lifeConfig';
import { findConstitution } from './lifeEngine';
import type { ChoiceEvent, LifeDirector, LifeState } from './lifeTypes';

export function createDeterministicDirector(): LifeDirector {
  return {
    source: 'deterministic',
    getChoiceEvent(state: LifeState): ChoiceEvent {
      const constitution = findConstitution(state.profile?.constitutionId);
      if (state.phase === 'FATE_CHOICE_INTENT') {
        return buildIntentEvent(constitution);
      }
      if (state.phase === 'FATE_CHOICE_FATE') {
        return buildFateEvent(constitution);
      }
      // 兜底：非选择阶段返回第一剑事件（App 只在选择阶段调用；防御式安全）
      return buildIntentEvent(constitution);
    },
    getChapterResult(state: LifeState): { title: string; lines: string[] } {
      const constitution = findConstitution(state.profile?.constitutionId);
      const intent = INTENT_OPTIONS.find((o) => o.id === state.chosen.intent);
      const fate = FATE_OPTIONS.find((o) => o.id === state.chosen.fate);
      const lines: string[] = [];
      lines.push(`本局身份：${state.profile?.name ?? '无名剑客'}`);
      if (intent) lines.push(`第一剑 · 择意 —— ${intent.title}：${intent.resultText}`);
      if (constitution) lines.push(`体质之痕 —— ${constitution.title}：${constitution.chapterSummary}`);
      const resp = state.companionState.response;
      if (resp === 'warm' || resp === 'reserved') {
        lines.push(`同行者 —— 燕迟：${COMPANION.responses[resp].text}`);
      } else if (state.companionState.skipped) {
        lines.push(`同行者 —— 燕迟：${COMPANION.skip.text}`);
      }
      if (fate) lines.push(`第二剑 · 定命 —— ${fate.title}：${fate.resultText}`);
      lines.push('雾岭的第一夜落下，你的境界自「剑道初相」推入「练气一层」。');
      return { title: CHAPTER_RESULT_TITLE, lines };
    },
  };
}

/** 章回开场文案（供 CHAPTER_EVENT 阶段展示） */
export function getChapterOpening(state: LifeState): { title: string; text: string } {
  const constitution = findConstitution(state.profile?.constitutionId);
  return {
    title: CHAPTER_ONE_TITLE,
    text: `${constitution?.chapterOpeningFlavor ?? ''}\n${CHAPTER_ONE_OPENING}`,
  };
}

/** 同行者事件文案 */
export function getCompanionEvent(): { title: string; text: string } {
  return {
    title: COMPANION_TITLE,
    text: COMPANION.encounterText,
  };
}

/** 踏入九州边界文案（不含任何地图/探索数据） */
export function getJourneyGate(): { title: string; text: string } {
  return {
    title: JOURNEY_GATE_TITLE,
    text: '九州在雾外。此为下一阶段的入口——山川、城郭与剑缘，尚未展开。',
  };
}

export { INTENT_OPTIONS, FATE_OPTIONS, COMPANION };