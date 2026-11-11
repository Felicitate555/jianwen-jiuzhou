/**
 * landmark 8（食指指尖）→ 画布坐标的镜像映射。
 *
 * 视频预览以 CSS transform: scaleX(-1) 呈现自拍镜像，画布坐标系必须同步镜像：
 * 玩家向左移动手，画布上的剑尖也向左移动。
 *
 * 视频以 object-cover 铺满画布时可能存在裁剪，此处按 cover 缩放计算真实映射，
 * 避免宽高比不一致时产生坐标偏移。
 */
export interface LandmarkLike {
  x: number;
  y: number;
}

export interface CanvasMapping {
  x: number;
  y: number;
}

export function mapLandmark8ToCanvas(
  lm: LandmarkLike,
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
): CanvasMapping {
  // 视频尺寸未知时退化为直接镜像映射
  if (videoW <= 0 || videoH <= 0 || canvasW <= 0 || canvasH <= 0) {
    return { x: (1 - lm.x) * canvasW, y: lm.y * canvasH };
  }
  // object-cover：取较大缩放比，铺满画布并居中裁剪
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  const offX = (dispW - canvasW) / 2;
  const offY = (dispH - canvasH) / 2;
  // 未镜像的画布像素坐标
  const px = lm.x * dispW - offX;
  const py = lm.y * dispH - offY;
  // 水平镜像：与视频预览的 scaleX(-1) 一致
  return { x: canvasW - px, y: py };
}