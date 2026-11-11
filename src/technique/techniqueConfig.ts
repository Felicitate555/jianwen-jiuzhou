/**
 * 第四阶段：基础剑招（Technique）层集中配置。
 *
 * 三式固定剑招：斜劈（单笔对角）、十字剑（两笔对角交叉）、回风式（受控回转闭合）。
 * 全部几何阈值按「舞台宽度比例」归一化，不写死像素；识别失败一律安全回退普通剑击。
 * 倍率/成本刻意保守：招式收益只叠加在原有一次斩击结算上，受低气机/失控系数约束，
 * 不会产生额外免费斩击或第二套碰撞。
 */

export type TechniqueKind = 'NONE' | 'DIAGONAL_SLASH' | 'CROSS' | 'RETURN_WIND';

export type ConcreteTechniqueKind = Exclude<TechniqueKind, 'NONE'>;

export interface DiagonalSlashConfig {
  /** 反馈文案（提示与 HUD） */
  name: string;
  /** HUD 简短二维轨迹提示 */
  hint: string;
  /** 识别所需最低轨迹总长（× 舞台宽，与普通斩击同阈值可独立调整） */
  minPathRatio: number;
  /** 直线率下限：起终点直线距离 / 轨迹总长（防来回乱划） */
  minStraightness: number;
  /** 主方向与水平线夹角下限（度）：低于视为接近水平，拒绝 */
  angleToHorizontalMinDeg: number;
  /** 主方向与水平线夹角上限（度）：高于视为接近垂直，拒绝 */
  angleToHorizontalMaxDeg: number;
  /** 相邻有效位移反向（点积 < 0）的最大次数 */
  maxReversalSteps: number;
  /** 反向步进累计长度占轨迹总长的上限 */
  maxReversalLenRatio: number;
  /** 置信度下限（0~1，宁漏勿滥） */
  minConfidence: number;
  /** 成招额外气机成本（叠加在普通斩击成本上） */
  extraQiCost: number;
  /** 伤害倍率上限（只作用于本段身体命中的一次结算） */
  damageMultiplier: number;
  /** 成招冷却（ms），防止连发 */
  cooldownMs: number;
}

export interface CrossConfig {
  name: string;
  hint: string;
  /** 每笔最低路径长度（× 舞台宽） */
  minStrokePathRatio: number;
  /** 每笔直线率下限（笔内 |终点-起点| / 笔长） */
  perStrokeStraightness: number;
  /** 每笔与水平线夹角范围（度），两笔都必须是对角线 */
  angleToHorizontalMinDeg: number;
  angleToHorizontalMaxDeg: number;
  /** 两笔方向向量最小交角（度） */
  minCrossAngleDeg: number;
  /** 交点在两笔上的参数范围（0~1，中部交叉才有效） */
  centerParamMin: number;
  centerParamMax: number;
  /** 跨段拼合窗口（ms）：第一笔结束到第二笔开始的间隔上限 */
  crossWindowMs: number;
  /** 单段两笔十字的合并净转向上限（度）：排除圆弧误判 */
  maxNetTurnDeg: number;
  minConfidence: number;
  extraQiCost: number;
  damageMultiplier: number;
  cooldownMs: number;
}

export interface ReturnWindConfig {
  name: string;
  hint: string;
  /** 轨迹总长下限（× 舞台宽），保证不是原地小动作 */
  minPathRatio: number;
  /** 端点距离 / 轨迹总长 上限（终点须回到起点附近） */
  closeMaxPathRatio: number;
  /** 端点距离绝对上限（× 舞台宽） */
  closeMaxAbsRatio: number;
  /** 累计带符号转向下限（度）：受控弧形回转至少大半圈 */
  netTurnMinDeg: number;
  /** 累计带符号转向上限（度）：排除连续多圈 */
  netTurnMaxDeg: number;
  /** 转向符号一致率下限（受控弧形 vs 无规律折返） */
  turnConsistencyMin: number;
  /** 包围盒对角线下限（× 舞台宽）：排除极小圆与静止抖动 */
  minExtentRatio: number;
  /** 反向步进最大次数（弧形允许少量抖动） */
  maxReversalSteps: number;
  /** 反向步进累计长度占比上限 */
  maxReversalLenRatio: number;
  minConfidence: number;
  extraQiCost: number;
  damageMultiplier: number;
  cooldownMs: number;
}

export interface TechniqueConfig {
  /** 识别优先级：具体形态在前，一般形态在后 */
  priority: ConcreteTechniqueKind[];
  /** 招式剑气形态持续时长（ms，克制范围 300~800） */
  fxDurationMs: number;
  /** 招式文字提示持续时长（ms） */
  promptMs: number;
  /** 去抖最小步长（× 舞台宽，识别专用，不回写 SwordEngine） */
  dedupeMinStepRatio: number;
  /** 笔画分割角（度）：局部方向偏转超过该角且已有足够长度时开新笔 */
  strokeSplitAngleDeg: number;
  /** 笔画分割所需最小已累积长度（× 舞台宽） */
  strokeMinSplitLenRatio: number;
  diagonalSlash: DiagonalSlashConfig;
  cross: CrossConfig;
  returnWind: ReturnWindConfig;
}

export const DEFAULT_TECHNIQUE_CONFIG: TechniqueConfig = {
  priority: ['CROSS', 'RETURN_WIND', 'DIAGONAL_SLASH'],
  fxDurationMs: 800,
  promptMs: 800,
  dedupeMinStepRatio: 0.002,
  strokeSplitAngleDeg: 50,
  strokeMinSplitLenRatio: 0.035,
  diagonalSlash: {
    name: '斜劈',
    hint: '一笔对角 · 左上右下皆可',
    // 容错校准（测试阶段）：摄像头 landmark 轻微抖动/漂移下放宽几何门槛，
    // 仍保留乱挥防线（路径长度 + 主方向角度 + 直线率 + 低反复 + 置信度）
    minPathRatio: 0.08,
    minStraightness: 0.7,
    angleToHorizontalMinDeg: 20,
    angleToHorizontalMaxDeg: 68,
    maxReversalSteps: 4,
    maxReversalLenRatio: 0.2,
    minConfidence: 0.52,
    extraQiCost: 5,
    damageMultiplier: 1.15,
    cooldownMs: 700,
  },
  cross: {
    name: '十字剑',
    hint: '两笔对角 · 交叉而过',
    // 容错校准：两笔仍必须真实交叉（长度/角度/交角/交点中部/窗口内完成），
    // crossWindowMs 550 容纳约 25FPS 摄像头采样间隔
    minStrokePathRatio: 0.075,
    perStrokeStraightness: 0.64,
    angleToHorizontalMinDeg: 18,
    angleToHorizontalMaxDeg: 72,
    minCrossAngleDeg: 30,
    centerParamMin: 0.15,
    centerParamMax: 0.85,
    crossWindowMs: 550,
    maxNetTurnDeg: 320,
    minConfidence: 0.54,
    extraQiCost: 9,
    damageMultiplier: 1.35,
    cooldownMs: 1000,
  },
  returnWind: {
    name: '回风式',
    hint: '弧形回转 · 剑归原位',
    // 容错校准：仍需受控闭合回转（端点闭合 + 累计转向 + 一致性 + 范围），
    // 小圆/停着抖动/无限折返防线保留。
    // netTurnMinDeg 不取 170：四段折返乱划实测净转向 ≈177°，落在 170~190 会被误收，
    // 故取 180（仍比旧 190 宽容）；minExtentRatio 不取 0.13：直径 80px 小圆对角线 113px
    // 会越过 0.13×舞台宽，故取 0.15（仍比旧 0.16 宽容），拦住既有小圆负例
    minPathRatio: 0.1,
    closeMaxPathRatio: 0.42,
    closeMaxAbsRatio: 0.22,
    netTurnMinDeg: 180,
    netTurnMaxDeg: 440,
    turnConsistencyMin: 0.54,
    minExtentRatio: 0.15,
    maxReversalSteps: 6,
    maxReversalLenRatio: 0.35,
    minConfidence: 0.52,
    extraQiCost: 7,
    damageMultiplier: 1.25,
    cooldownMs: 900,
  },
};

/**
 * 练习模式配置（PRACTICE_TECHNIQUE_CONFIG）：
 * 机缘练习窗口内使用的宽容阈值——几何形态仍是同一套真实三式识别
 * （同 TechniqueEngine、同 Camera/Pointer 路径），只放宽对「教学期」的
 * 直线率/置信度/轨迹长度/冷却要求，便于初次接触的玩家成招。
 * - 不修改战斗阈值：普通战斗仍用 DEFAULT_TECHNIQUE_CONFIG（宁漏勿滥）；
 * - 不进入 MediaPipe/输入层：练习判定发生在 TechniqueEngine 常规分类之上；
 * - 只有练习配置下识别成功才允许写 learned（战斗 commit 不再自动领悟）。
 */
export const PRACTICE_TECHNIQUE_CONFIG: TechniqueConfig = {
  ...DEFAULT_TECHNIQUE_CONFIG,
  diagonalSlash: {
    ...DEFAULT_TECHNIQUE_CONFIG.diagonalSlash,
    minPathRatio: 0.06,
    minStraightness: 0.62,
    minConfidence: 0.45,
    cooldownMs: 300,
  },
  cross: {
    ...DEFAULT_TECHNIQUE_CONFIG.cross,
    minStrokePathRatio: 0.055,
    perStrokeStraightness: 0.58,
    minCrossAngleDeg: 26,
    minConfidence: 0.45,
    crossWindowMs: 800,
    cooldownMs: 400,
  },
  returnWind: {
    ...DEFAULT_TECHNIQUE_CONFIG.returnWind,
    minPathRatio: 0.08,
    closeMaxPathRatio: 0.5,
    closeMaxAbsRatio: 0.26,
    netTurnMinDeg: 165,
    turnConsistencyMin: 0.5,
    minConfidence: 0.45,
    cooldownMs: 400,
  },
};