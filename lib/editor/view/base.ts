import { Rect } from '../base/rect';
import type { Canvas as SkCanvas, Path as SkPath, Color as SkColor, ImageFilter } from 'canvaskit-wasm';
import { SkyView } from './sky-view';
import {
  SkyBaseLayer,
  SkyBaseGroup,
  ClassValue,
  SkyGroup,
  SkyColor,
  SkyShadow,
  SkyPatternFillType,
  SkPaint,
  SkyBlurType,
} from '../model';

import {
  SkyShapeGroupView,
  SkyShapePathLikeView,
  SkyBitmapView,
  SkyTextView,
  SkySymbolInstanceView,
  SkySymbolMasterView,
  SkyArtboardView,
} from '.';
import { Transform } from '../base/transform';
import { degreeToRadian } from '../base/common';
import { Point } from '../base/point';
import sk, { newStrokePaint, newColorPaint } from '../util/canvaskit';
import { convertRadiusToSigma } from '../util/sketch-to-skia';
import { CacheGetter } from '../util/misc';

export { SkCanvas };

let viewId = 0;
// window.cnt = 0;

export interface RenderCtx {
  cullRect: Rect;
}

export abstract class SkyBaseView {
  id: number;
  children: SkyBaseView[] = [];

  ctx: SkyView;
  parent?: SkyBaseView;

  constructor() {
    this.ctx = SkyView.currentContext;
    this.id = viewId++;
    if (process.env.NODE_ENV === 'development') {
      const obj = (window as any).viewMap || ((window as any).viewMap = {});
      obj[this.id] = this;
    }
  }

  get visible() {
    return true;
  }

  // get clipPath(): SkPath | undefined {
  //   return undefined;
  // }

  // 作用在 siblings 之间
  get breakClipChain() {
    return false;
  }

  get hasClip() {
    return false;
  }

  // clip 需要在 render 之后
  // 比较蛋疼的一点是，如果 clip 的时候需要 transform ，那么 restore 的时候会把 clip 也 清除掉
  tryClip() {}

  prependChild<T extends SkyBaseView>(child: T): T {
    child.parent = this;
    this.children.unshift(child);
    return child;
  }

  addChild<T extends SkyBaseView>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /**
   * @param point 在 parent 的坐标系中
   */
  abstract containsPoint(point: Point): boolean;

  abstract parentToLocal(pt: Point): Point;
  // {
  // const localPt = this.transform.localTransform.applyInverse(pt);

  // }

  // pt 在 parent 坐标系中
  findView(pt: Point) {
    const localPt = this.parentToLocal(pt);
    for (let i = this.children.length - 1; i >= 0; i--) {
      const childView = this.children[i];
      if (!childView.visible) continue;
      // const newPt = childView.transform.localTransform.applyInverse(pt);
      if (childView.containsPoint(localPt)) {
        return childView.findView(localPt) || childView;
      }
    }
    return undefined;
  }

  private _layoutDirty = true;

  layout() {
    if (!this._layoutDirty) return;

    this.layoutSelf();
    this.layoutChildren();

    this._layoutDirty = false;
  }

  layoutSelf() {}

  layoutChildren() {
    for (let i = 0; i < this.children.length; i++) {
      const childView = this.children[i];

      // 不可见还是要 layout 的，因为可能有 mask
      childView.layout();
    }
  }

  protected renderChildren() {
    // const { skCanvas } = this.ctx;

    let clipCount = 0;

    let isClipping = false;

    const { skCanvas } = this.ctx;

    for (let i = 0; i < this.children.length; i++) {
      const childView = this.children[i];

      // const childClipPath = childView.clipPath;

      // 即使不可见也应该能够 clip
      // if (childClipPath) {
      //   skCanvas.clipPath(childClipPath, sk.CanvasKit.ClipOp.Intersect, false);
      // }

      if ((childView.hasClip || childView.breakClipChain) && isClipping) {
        skCanvas.restore();
        isClipping = false;
      }

      if (childView.visible) {
        childView.render();
      }

      if (childView.hasClip) {
        skCanvas.save();
        childView.tryClip();
        isClipping = true;
      }
    }

    if (isClipping) {
      skCanvas.restore();
    }
    // while (clipCount--) {
    // skCanvas.restore();
    // }
    // skCanvas.restoreToCount()
  }

  debugString() {
    return `<${this.constructor.name}>(${this.id})`;
  }
  // abstract render(ctx: RenderCtx);
  abstract render();
}

// box 使用最简单的 frame 定位方式
// 如果需要 rotate ，可以在外层加上一个 RotateView
export class SkyBoxView extends SkyBaseView {
  clip = true;
  backgroundColor?: SkColor;
  shadow?: SkyShadow;

  constructor(public frame: Rect) {
    super();
  }

  render() {
    // render({ cullRect }: RenderCtx) {
    this.renderBackground();
    this.renderSelf();
    this.renderChildren();
  }

  parentToLocal(pt: Point) {
    return pt.clone().move(this.frame.x, this.frame.y);
  }

  renderSelf() {
    //
  }

  renderBackground() {
    const { skCanvas } = this.ctx;

    if (this.shadow) {
      const { color, blurRadius, offsetX, offsetY } = this.shadow;
      const paint = new sk.CanvasKit.Paint();
      paint.setColor(color.skColor);
      paint.setMaskFilter(sk.CanvasKit.MaskFilter.MakeBlur(sk.CanvasKit.BlurStyle.Normal, blurRadius / 2, true));
      skCanvas.drawRect(this.frame.offset(offsetX, offsetY).toSk(), paint);
    }

    if (this.backgroundColor) {
      skCanvas.drawRect(this.frame.toSk(), newColorPaint(this.backgroundColor));
    }
  }

  protected renderChildren() {
    if (!this.children.length) return;
    const { skCanvas } = this.ctx;
    skCanvas.save();
    if (this.clip) skCanvas.clipRect(this.frame.toSk(), sk.CanvasKit.ClipOp.Intersect, true);
    // skCanvas.concat(this.transform.localTransform.toArray(false));
    skCanvas.translate(this.frame.x, this.frame.y);
    // this.children.forEach((child) => child.visible && child.render());
    super.renderChildren();
    skCanvas.restore();
  }

  containsPoint(pt: Point) {
    // const localPt = this.transform.localTransform.applyInverse(pt);
    return this.frame.containsPoint(pt);
  }
}

// 先不做基础抽象了，这个地方就当作 sketch layer view 的抽象吧
export abstract class SkyBaseLayerView<T extends SkyBaseLayer = SkyBaseLayer> extends SkyBaseView {
  layerUpdateId = 100;

  parent?: SkyBaseLayerView;
  transform = new Transform();

  protected selected = false;

  // 是否需要 layer 上应用 shadow。
  // path 之类的 shadow 之类的 shadow 是在绘制的时候设置的
  requireLayerDropShadow = false;
  // savedLayer = false;

  // undefined 表示还未初始化，null 表示不需要
  layerPaint: SkPaint | null | undefined;

  protected _transformDirty = true;

  // visible = true;
  // clip = false;

  // 有 frame 也方便 debug
  constructor(public model: T) {
    super();
    if (this.model instanceof SkyBaseGroup) {
      this.buildChildren(this.model.layers);
    }
  }

  get visible() {
    return this.model.isVisible;
  }

  get hasClip() {
    return this.model.hasClippingMask;
  }

  get breakClipChain() {
    return this.model.shouldBreakMaskChain;
  }

  buildChildren(layers: SkyBaseGroup['layers']) {
    layers.forEach((childModel) => {
      switch (childModel._class) {
        case ClassValue.Group:
          this.addChild(new SkyGroupView(childModel));
          return;
        case ClassValue.ShapeGroup:
          this.addChild(new SkyShapeGroupView(childModel));
          return;
        // case ClassValue.ShapePath:
        // case ClassValue.Rectangle:
        // case ClassValue.Star:
        // case ClassValue.Triangle:
        // case ClassValue.Oval:
        case ClassValue.ShapeLike:
          return this.addChild(new SkyShapePathLikeView(childModel));
        case ClassValue.Bitmap:
          return this.addChild(new SkyBitmapView(childModel));
        case ClassValue.Text:
          return this.addChild(new SkyTextView(childModel));
        case ClassValue.SymbolInstance:
          return this.addChild(new SkySymbolInstanceView(childModel));
        case ClassValue.SymbolMaster:
          return this.addChild(new SkySymbolMasterView(childModel));
        case ClassValue.Artboard:
          return this.addChild(new SkyArtboardView(childModel));
      }
    });
  }

  /**
   * 关于 transform：
   * pivot 表示的是以哪里作为 scale/rotate的中心。 position 表示了 pivot 这个点在父坐标系中的位置。
   *
   * 关于 sketch frame
   * frame 不会受到 rotate、scale 改变。
   * 表示的是，在没有 rotate、scale 时的位置和大小。
   *
   * 所以：
   * sketch 中 pivot 默认是 frame 中心。
   * position 也很好计算，scale、rotate 都没有改变它，还是 frame 中心。
   *
   * 之前直接使用 canvas 上的 translate、rotate 方法，实际上是多个 matrix 相乘
   * 现在则是一次生成 matrix，有许多地方要注意。
   *
   * 有一点没搞明白：
   * 逆时针旋转，sketch 显示的 -xx 度，实际存储的是正数。
   * 但为什么到我这里，我还要再加负号呢？
   *
   */
  updateTransform() {
    const { isFlippedHorizontal, isFlippedVertical, rotation } = this.model;

    const frame = this.frame;

    this.transform.pivot.set(frame.width / 2, frame.height / 2);

    const scaleX = isFlippedHorizontal ? -1 : 1;
    const scaleY = isFlippedVertical ? -1 : 1;
    this.transform.scale.set(scaleX, scaleY);

    const radian = -1 * scaleX * scaleY * degreeToRadian(rotation);

    this.transform.rotation = radian;

    this.transform.position.set(frame.x + frame.width / 2, frame.y + frame.height / 2);
    this.transform.updateLocalTransform();
    this._transformDirty = false;
  }

  /**
   * 如果当前 layer 在 instance 内部时，需要的 scale。
   * 计算 scale 和 offset
   * 不同类型的 layer 有不同的 scale 方式，但 scale/offset 值计算方式是一样的。
   *
   *
   * Todo
   * 这个方法应该分成两步，
   * 1 先计算 scale
   * 2 scale 改变 frame，用新的 frame 计算 offset。
   *
   */
  calcInstanceChildScale() {
    // const symbolCtx = this.ctx.symbolContext;
    // // 不再任何 instance 内，直接返回
    // if (!symbolCtx) return;

    const parent = this.parent;

    // Todo 这个可能有问题， 如果我在某个 layer 中用了 SkyBoxView 的话。
    // 目前就只在 master 上用了，所以对 instance layout 影响不大
    if (!(parent instanceof SkyBaseLayerView)) return;
    if (!parent.isFrameScaled) return;

    const instanceFrame = parent.frame;
    const masterFrame = parent.intrinsicFrame;

    const instanceScaleX = instanceFrame.width / masterFrame.width;
    const instanceScaleY = instanceFrame.height / masterFrame.height;

    let scaleX = this.model.fixedWidth ? 1 : instanceScaleX;
    let scaleY = this.model.fixedHeight ? 1 : instanceScaleY;

    const curFrame = this.frame;

    // 两边 snap， 拉伸
    if (this.model.snapLeft && this.model.snapRight) {
      const rightLefMargin = masterFrame.width - curFrame.width;
      const newWidth = instanceFrame.width - rightLefMargin;

      scaleX = newWidth / curFrame.width;

      // 对齐左侧，无需 offset
    } else if (this.model.snapRight) {
      const oldRight = masterFrame.width - curFrame.width - curFrame.x;

      // mojoscale
      if (!this.model.fixedWidth) {
        scaleX = (masterFrame.width * instanceScaleX - oldRight) / (masterFrame.width - oldRight);
      }

      // 对齐右侧的时候需要计算 offset

      // const newLeft = instanceFrame.width - curFrame.width * scaleX - oldRight;
      // offsetX = newLeft - curFrame.x;
    } else if (this.model.snapLeft) {
      // 对齐左侧无需 offset

      // mojoscale
      if (!this.model.fixedWidth) {
        scaleX = (masterFrame.width * instanceScaleX - curFrame.x) / (masterFrame.width - curFrame.x);
      }
    } else {
      // 既没有对齐左侧，也没有对齐右侧
      // 保持中心位置不变
      // const oldCenter = curFrame.x + curFrame.width / 2;
      // const oldCenterRatio = oldCenter / masterFrame.width;
      // const newCenter = oldCenterRatio * instanceFrame.width;
      // const newLeft = newCenter - (scaleX * curFrame.width) / 2;
      // offsetX = newLeft - curFrame.x;
    }

    // 上下 snap， 拉伸
    if (this.model.snapTop && this.model.snapBottom) {
      const verMargin = masterFrame.height - curFrame.height;
      const newHeight = instanceFrame.height - verMargin;

      scaleY = newHeight / curFrame.height;

      // 对齐上侧，无需 offset
    } else if (this.model.snapBottom) {
      const oldBottom = masterFrame.height - curFrame.height - curFrame.y;

      // mojoscale
      if (!this.model.fixedHeight) {
        scaleY = (masterFrame.height * instanceScaleY - oldBottom) / (masterFrame.height - oldBottom);
      }

      // 对齐底部的时候需要计算 offset

      // const newTop = instanceFrame.height - curFrame.height * scaleY - oldBottom;
      // offsetY = newTop - curFrame.y;
    } else if (this.model.snapTop) {
      // 对齐左侧无需 offset

      // mojoscale
      if (!this.model.fixedHeight) {
        scaleY = (masterFrame.height * instanceScaleY - curFrame.y) / (masterFrame.height - curFrame.y);
      }
    } else {
      // 既没有对齐左侧，也没有对齐右侧
      // 保持中心位置不变
      // const oldCenter = curFrame.y + curFrame.height / 2;
      // const oldCenterRatio = oldCenter / masterFrame.height;
      // const newCenter = oldCenterRatio * instanceFrame.height;
      // const newTop = newCenter - (scaleY * curFrame.height) / 2;
      // offsetY = newTop - curFrame.y;
    }

    return {
      scaleX,
      scaleY,
    };
  }

  calcOffsetAfterScale(newBounds: Rect, oldBounds?: Rect) {
    const parent = this.parent as SkyBaseLayerView;

    const instanceFrame = parent.frame;
    const masterFrame = parent.intrinsicFrame;

    const curFrame = oldBounds || this.frame;

    let newX = curFrame.x;
    let newY = curFrame.y;

    // 两边 snap， 拉伸
    if (this.model.snapLeft && this.model.snapRight) {
      // 对齐左侧，无需 offset
    } else if (this.model.snapRight) {
      const oldRight = masterFrame.width - curFrame.width - curFrame.x;

      // 对齐右侧的时候需要计算 offset

      const newLeft = instanceFrame.width - newBounds.width - oldRight;
      // offsetX = newLeft - intrinsicFrame.x;
      newX = newLeft;
    } else if (this.model.snapLeft) {
      // 对齐左侧无需 offset
      // mojoscale
      // if (!this.model.fixedWidth) {
      //   scaleX = (masterFrame.width * instanceScaleX - intrinsicFrame.x) / (masterFrame.width - intrinsicFrame.x);
      // }
    } else {
      // 既没有对齐左侧，也没有对齐右侧
      // 保持中心位置不变
      const oldCenter = curFrame.x + curFrame.width / 2;
      const oldCenterRatio = oldCenter / masterFrame.width;
      const newCenter = oldCenterRatio * instanceFrame.width;
      const newLeft = newCenter - newBounds.width / 2;

      // offsetX = newLeft - intrinsicFrame.x;
      newX = newLeft;
    }

    // 上下 snap， 拉伸
    if (this.model.snapTop && this.model.snapBottom) {
      // 对齐上侧，无需 offset
    } else if (this.model.snapBottom) {
      const oldBottom = masterFrame.height - curFrame.height - curFrame.y;

      // 对齐底部的时候需要计算 offset

      const newTop = instanceFrame.height - newBounds.height - oldBottom;
      // offsetY = newTop - intrinsicFrame.y;
      newY = newTop;
    } else if (this.model.snapTop) {
      // 对齐左侧无需 offset
    } else {
      // 既没有对齐左侧，也没有对齐右侧
      // 保持中心位置不变
      const oldCenter = curFrame.y + curFrame.height / 2;
      const oldCenterRatio = oldCenter / masterFrame.height;
      const newCenter = oldCenterRatio * instanceFrame.height;
      const newTop = newCenter - newBounds.height / 2;

      // offsetY = newTop - intrinsicFrame.y;
      newY = newTop;
    }

    return {
      newX,
      newY,
    };
  }

  /**
   * 对于 Group 和 instance 都使用这种方式， 但继承的基类不同。所以抽离一个方法
   */
  commonLayoutSelf() {
    this.scaledFrame = undefined;
    const info = this.calcInstanceChildScale();
    if (!info) return;
    const { scaleX, scaleY } = info;

    // 被设置的 frame， 对于 instance 来说不能拿 refModel 的
    const oldFrame = this.model.frame;

    const newFrame = new Rect(0, 0, scaleX * oldFrame.width, scaleY * oldFrame.height);
    const { newX, newY } = this.calcOffsetAfterScale(newFrame);
    newFrame.x = newX;
    newFrame.y = newY;

    // console.log('debug', this.model.name, newFrame, intrinsicFrame);

    this.scaledFrame = newFrame;
  }

  debugString() {
    return `<${this.constructor.name}>(${this.id})[${this.model.name}]`;
  }

  // model 中写入的 frame
  get intrinsicFrame() {
    return this.model.frame;
  }

  protected scaledFrame?: Rect;

  // 这里两个 frame 的名字很有迷惑性

  // frame 应该是什么样的呢？

  // 一个是 用户设置的 frame / 原始 instance 上的
  // originFrame

  // 一个是 实际显示的 frame
  // showFrame

  // 还有个是 children 参考的 frame，大多数情况下，等同于 model.frame
  // frameForChildren

  // 大部分情况下
  // model.frame === originFrame === showFrame === frameForChildren

  // 在被 instance layout 后， originFrame 不再等于 showFrame

  // 一般来说， frameForChildren

  // 实际展示的 frame， 在 被 instance 缩放时会不一样
  get frame() {
    return this.scaledFrame || this.model.frame;
  }

  get isFrameScaled() {
    return this.intrinsicFrame.width !== this.frame.width || this.intrinsicFrame.height !== this.frame.height;
  }

  /**
   * 在 parent 坐标系中的一个 rect 区域，表示当前 layer 的绘制范围。
   * 因为 frame 表示的是未经过旋转和拉伸的。 所以这里 bounds 跟 frame 可能不同。
   *
   * frame 本身已经是内部区域的最小闭包矩形了，范围大于内部实际绘制内容。再经过一次变换后。
   * bounds 实际上是不怎么紧凑的。但问题不大。
   */
  @CacheGetter<SkyBaseLayerView>((ins) => ins.layerUpdateId)
  get bounds() {
    const { x, y, width, height } = this.renderFrame;
    const matrix = this.transform.localTransform.toArray(false);
    const numbs = sk.CanvasKit.Matrix.mapPoints(matrix, [x, y, width, y, width, height, x, height]);
    const points = [] as Point[];
    // numbs.forEach(num)
    for (let i = 0; i < numbs.length; i += 2) {
      points.push(new Point(numbs[i], numbs[i + 1]));
    }
    return Rect.fromPoints(points);
  }

  /**
   * 上面那个 bounds 并不是绘制的实际 bounds, 只是绘制的 path 的实际范围。
   * 如果遇到了 shadow、stroke、blur 等等，实际的绘制区域是要扩散的
   *
   * 这个跟 bounds 还不一样， bounds 是在 parent 坐标系中的，这个是在自身坐标系中的。
   * 能不能够统一一下呢？感觉还是可以的，不过需要注意一下 frame 的 x,y
   *
   * 这个 renderFrame 完全在当前坐标系中，x，y 表示的是当前坐标系中的偏移。
   * 如果遇到 shadow、blur、stroke 等扩张了渲染区域，那么 x、y 应该是负数。width、height 相对 frame 变大。
   *
   * 主要就是为了做 quickReject
   * 这个是在自身的坐标系中
   */
  @CacheGetter<SkyBaseLayerView>((ins) => ins.layerUpdateId)
  get renderFrame() {
    return this.model.inflateFrame(this.frame.onlySize);
  }

  protected calcChildrenRenderFrame(children: SkyBaseLayerView[]) {
    if (children.length === 0) return Rect.Empty;
    return Rect.mergeRects(children.map((child) => child.bounds));
  }

  parentToLocal(pt: Point) {
    return this.transform.localTransform.applyInverse(pt);
  }

  protected applyTransform() {
    const { skCanvas } = this.ctx;
    // skCanvas.getLocalToDevice
    const arr = this.transform.localTransform.toArray(false);
    skCanvas.concat(arr);
    // console.log('>>>>', this.id, arr);
    // const frame = this.model.frame;

    // // translate
    // skCanvas.translate(frame.x, frame.y);

    // // Flip
    // skCanvas.scale(this.model.isFlippedHorizontal ? -1 : 1, this.model.isFlippedVertical ? -1 : 1);
    // skCanvas.translate(
    //   this.model.isFlippedHorizontal ? -frame.width : 0,
    //   -this.model.isFlippedVertical ? -frame.height : 0
    // );

    // Rotation
    // skCanvas.rotate(-this.model.rotation, frame.width / 2, frame.height / 2);
  }

  canQuickReject = true;

  layout() {
    // 在 layout 的时候更新下 transform，不然 bounds 算不对。
    if (this._transformDirty) {
      this.updateTransform();
    }
    super.layout();
  }

  // 只给外部调用，不支持继承
  render() {
    const { skCanvas } = this.ctx;
    skCanvas.save();

    this.applyTransform();

    const reject = skCanvas.quickReject(this.renderFrame.toSk());

    const shouldRender = !this.canQuickReject || !reject;

    // console.log('>>>> quick reject', this.debugString(), reject, shouldRender);
    if (shouldRender) {
      this.applyLayerStyle();

      this._render();
    }
    skCanvas.restore();

    // saveLayer 需要再次 restore 一次
    if (this.layerPaint && shouldRender) {
      skCanvas.restore();
    }
  }

  tryClip() {
    if (!this.hasClip) return;

    // 可能 render 没有被调用，所以本地 transform 要在这里更新
    // 但是吧，这个逻辑放在这里也不是很好，应该放在 layout 中的
    if (this._transformDirty) {
      this.updateTransform();
    }

    // 需要手动进行坐标转换，并回退
    const { skCanvas } = this.ctx;
    // const current = skCanvas.getTotalMatrix();
    // skCanvas.concat()

    const mat = this.transform.localTransform.toArray(false);
    skCanvas.concat(mat);
    this._tryClip();
    // const invertMat = this.transform.localTransform.clone().invert().toArray(false);
    skCanvas.concat(sk.CanvasKit.Matrix.invert(mat)!);
  }

  _tryClip() {}

  buildLayerPaint() {
    const { style, frame } = this.model;
    if (!style) {
      this.layerPaint = null;
      return;
    }

    const layerPaint = new sk.CanvasKit.Paint();
    let modified = false;
    const { contextSettings } = style;
    if (contextSettings) {
      if (contextSettings.opacity !== 1) {
        layerPaint.setAlphaf(contextSettings.opacity);
        modified = true;
      }
      if (contextSettings.blendMode !== sk.CanvasKit.BlendMode.Src) {
        layerPaint.setBlendMode(contextSettings.blendMode);
        modified = true;
      }
    }

    // Group 上的 shadow filter 和 其他类型的 blurFilter 是互斥的，不会同时设置。

    // Todo 判断下是哪些 layer 类型在应用 shadow
    // group 的情况下，只有一个 shadow
    if (this.requireLayerDropShadow && style.shadows?.[0]?.isEnabled) {
      const { color, blurRadius, offsetX, offsetY } = style.shadows[0];
      modified = true;
      layerPaint.setImageFilter(
        sk.CanvasKit.ImageFilter.MakeDropShadow(offsetX, offsetY, blurRadius / 2, blurRadius / 2, color.skColor, null)
      );
    }

    if (style.blur?.isEnabled) {
      const { type, radius, motionAngle } = style.blur;
      let imageFilter: ImageFilter | undefined;

      switch (type) {
        case SkyBlurType.Gaussian:
          imageFilter = sk.CanvasKit.ImageFilter.MakeBlur(radius, radius, sk.CanvasKit.TileMode.Clamp, null);
          break;
        case SkyBlurType.Motion:
          // imageFilter = sk.CanvasKit.ImageFilter._MakeMatrixConvolution();
          console.warn('unimplemented: motion blur');
          break;
        case SkyBlurType.Zoom:
          console.warn('unimplemented: zoom blur');
          break;
        case SkyBlurType.Background:
          console.warn('unimplemented: background blur');
          break;
      }

      if (imageFilter) {
        layerPaint.setImageFilter(imageFilter);
        modified = true;
      }
    }

    if (modified) {
      this.layerPaint = layerPaint;
    } else {
      this.layerPaint = null;
    }
  }

  applyLayerStyle() {
    if (this.layerPaint === undefined) {
      this.buildLayerPaint();
    }
    if (this.layerPaint) {
      const { skCanvas } = this.ctx;

      skCanvas.saveLayer(this.layerPaint);
    }

    // if (modified) {
    // CanvasKit.XYWHRect(0, 0, frame.width, frame.height)
    // 太好了，saveLayer 可以不传 bounds 大小
    // 如果非要传递的话计算起来还挺麻烦，因为 stroke 通常会超出 frame。

    // # Save layer
    // 可以应用 paint 参数类型， （mask filter 不行）
    // Optional SkPaint paint applies alpha, SkColorFilter, SkImageFilter, and SkBlendMode when restore() is called.
    // https://api.skia.org/classSkCanvas.html#a06bd76ce35082366bb6b8e6dfcb6f435

    // skCanvas.saveLayer(layerPaint);
    // this.savedLayer = true;
    // window.cnt++;
    // }
  }

  // To be override
  abstract _render();

  // visitChildren(fn: (child: SkyBaseView) => void) {

  // }

  // {
  // const paint = new sk.CanvasKit.Paint();
  // paint.setColor(sk.CanvasKit.RED);

  // this.ctx.skCanvas.drawRect(this.model.frame.onlySize.toSk(), paint);

  // }

  // markDirty() {
  //   this.parent?.markDirty();
  // }

  containsPoint(pt: Point) {
    const localPt = this.transform.localTransform.applyInverse(pt);
    return this.frame.onlySize.containsPoint(localPt);
  }

  select() {
    this.selected = true;
    this.ctx.markDirty();
  }

  unselect() {
    this.selected = false;
    this.ctx.markDirty();
  }
}

// 干掉这个. 有点影响继承。
// 这个类看起来不太需要了，children 相关已经移动到上层 SkyBaseLayerView 中了。
export abstract class SkyBaseGroupView<T extends SkyBaseGroup = SkyBaseGroup> extends SkyBaseLayerView<T> {
  children!: SkyBaseLayerView[];

  @CacheGetter<SkyBaseLayerView>((ins) => ins.layerUpdateId)
  get renderFrame() {
    return this.calcChildrenRenderFrame(this.children);
  }

  _render() {
    this.renderChildren();
  }
}

export class SkyGroupView extends SkyBaseGroupView<SkyGroup> {
  requireLayerDropShadow = true;

  layoutSelf() {
    this.commonLayoutSelf();
  }
}
