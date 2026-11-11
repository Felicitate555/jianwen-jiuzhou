/**
 * 检测循环调度器：与渲染循环（requestAnimationFrame）分离。
 *
 * 调度策略（开始到开始固定周期）：
 * - 以首帧执行时刻为锚点，第 n 次检测应在 anchor + n * intervalMs 开始执行；
 * - tick（含推理耗时）完成后，按锚点计算下一次执行的剩余等待时间，
 *   即推理耗时计入周期内，且耗时不稳定时仍按绝对时间校准，周期漂移不累积；
 * - 不忙等：剩余等待为 0 时立即调度下一次。
 *
 * 通过 generation token 保证 stop() 之后旧循环不可能复活，
 * 重复 start() 不会创建并行循环；任意时刻仅存在一个检测循环。
 */
export class DetectionLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private generation = 0;
  /** 调度锚点：首帧执行时刻（performance.now 域） */
  private anchor = 0;
  /** 已调度次数（按锚点计算绝对执行时刻，防止漂移） */
  private scheduled = 0;

  constructor(
    private intervalMs: number,
    private tick: () => void,
    private now: () => number = () => performance.now(),
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const gen = ++this.generation;
    this.anchor = this.now();
    this.scheduled = 0;
    this.schedule(gen);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(gen: number): void {
    this.scheduled++;
    // 第 n 次检测的绝对开始时刻 = 锚点 + n * interval（推理耗时含在周期内）
    const nextAt = this.anchor + this.scheduled * this.intervalMs;
    const delay = Math.max(0, nextAt - this.now());
    this.timer = setTimeout(() => this.step(gen), delay);
  }

  private step(gen: number): void {
    if (!this.running || gen !== this.generation) return;
    try {
      this.tick();
    } catch {
      // 单次 tick 异常不中断后续调度（错误由 tick 内部上报）
    }
    if (this.running && gen === this.generation) {
      this.schedule(gen);
    }
  }
}