// Embind API for Aseprite WASM core (document I/O, render, editing, undo).

#include "memory_file_interface.h"

#include "dio/aseprite_decoder.h"
#include "dio/aseprite_encoder.h"
#include "dio/decode_delegate.h"
#include "dio/decode_file.h"
#include "dio/encode_delegate.h"
#include "doc/algorithm/floodfill.h"
#include "doc/cel.h"
#include "doc/color.h"
#include "doc/color_mode.h"
#include "doc/image.h"
#include "doc/image_ref.h"
#include "doc/image_spec.h"
#include "doc/layer.h"
#include "doc/palette.h"
#include "doc/primitives.h"
#include "doc/frames_sequence.h"
#include "doc/slice.h"
#include "doc/slices.h"
#include "doc/sprite.h"
#include "doc/tag.h"
#include "doc/tags.h"
#include "gfx/rect.h"
#include "render/onionskin_options.h"
#include "render/render.h"
#include "undo/undo_command.h"
#include "undo/undo_history.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace emscripten;

namespace {

class SpriteHolder : public dio::DecodeDelegate {
public:
  doc::Sprite* sprite = nullptr;
  std::string lastError;

  void error(const std::string& msg) override { lastError = msg; }
  void onSprite(doc::Sprite* s) override { sprite = s; }
};

class EncodeHolder : public dio::EncodeDelegate {
public:
  explicit EncodeHolder(doc::Sprite* s) : m_sprite(s)
  {
    m_frames.insert(0, s->lastFrame());
  }

  doc::Sprite* sprite() override { return m_sprite; }
  const doc::FramesSequence& framesSequence() const override { return m_frames; }
  bool composeGroups() override { return false; }
  bool preserveColorProfile() override { return true; }
  bool cacheCompressedTilesets() override { return false; }

private:
  doc::Sprite* m_sprite;
  doc::FramesSequence m_frames;
};

struct ImageSnapshotCmd : public undo::UndoCommand {
  doc::ImageRef target;
  std::unique_ptr<doc::Image> before;
  std::unique_ptr<doc::Image> after;

  ImageSnapshotCmd(doc::ImageRef t, std::unique_ptr<doc::Image> b, std::unique_ptr<doc::Image> a)
    : target(std::move(t))
    , before(std::move(b))
    , after(std::move(a))
  {
  }

  void undo() override
  {
    if (target && before)
      doc::copy_image(target.get(), before.get());
  }

  void redo() override
  {
    if (target && after)
      doc::copy_image(target.get(), after.get());
  }

  void dispose() override { delete this; }
};

doc::ColorMode toColorMode(int mode)
{
  switch (mode) {
    case 1:  return doc::ColorMode::GRAYSCALE;
    case 2:  return doc::ColorMode::INDEXED;
    default: return doc::ColorMode::RGB;
  }
}

int fromColorMode(doc::ColorMode mode)
{
  switch (mode) {
    case doc::ColorMode::GRAYSCALE: return 1;
    case doc::ColorMode::INDEXED:   return 2;
    default:                        return 0;
  }
}

class DocumentSession {
public:
  DocumentSession() { newSprite(64, 64, 0); }

  void newSprite(int width, int height, int colorMode)
  {
    width = std::max(1, std::min(width, 4096));
    height = std::max(1, std::min(height, 4096));
    auto* sprite = doc::Sprite::MakeStdSprite(
      doc::ImageSpec(toColorMode(colorMode), width, height));
    resetSprite(sprite);
  }

  bool loadAseprite(const val& bytes)
  {
    const unsigned length = bytes["length"].as<unsigned>();
    std::vector<uint8_t> data(length);
    if (length > 0) {
      val view = val::global("Uint8Array").new_(bytes);
      val memory = val(typed_memory_view(length, data.data()));
      memory.call<void>("set", view);
    }

    wasm::MemoryFileInterface file(std::move(data));
    SpriteHolder holder;
    if (!dio::decode_file(&holder, &file) || !holder.sprite) {
      m_lastError = holder.lastError.empty() ? "Failed to decode .aseprite" : holder.lastError;
      return false;
    }
    resetSprite(holder.sprite);
    return true;
  }

  val saveAseprite()
  {
    if (!m_sprite)
      return val::null();

    wasm::MemoryFileInterface file;
    EncodeHolder holder(m_sprite.get());
    dio::AsepriteEncoder encoder;
    encoder.initialize(&holder, &file);
    if (!encoder.encode()) {
      m_lastError = "Failed to encode .aseprite";
      return val::null();
    }

    const auto& data = file.data();
    val result = val::global("Uint8Array").new_(data.size());
    if (!data.empty()) {
      val memory = val(typed_memory_view(data.size(), const_cast<uint8_t*>(data.data())));
      result.call<void>("set", memory);
    }
    return result;
  }

  int width() const { return m_sprite ? m_sprite->width() : 0; }
  int height() const { return m_sprite ? m_sprite->height() : 0; }
  int colorMode() const
  {
    return m_sprite ? fromColorMode(m_sprite->colorMode()) : 0;
  }
  int totalFrames() const { return m_sprite ? (int)m_sprite->totalFrames() : 0; }
  int frameDuration(int frame) const
  {
    return m_sprite ? m_sprite->frameDuration(frame) : 100;
  }
  void setFrameDuration(int frame, int ms)
  {
    if (m_sprite)
      m_sprite->setFrameDuration(frame, ms);
  }

  int layerCount() const
  {
    if (!m_sprite)
      return 0;
    return (int)m_sprite->allBrowsableLayers().size();
  }

  std::string layerName(int index) const
  {
    auto* layer = layerAt(index);
    return layer ? layer->name() : std::string();
  }

  bool layerVisible(int index) const
  {
    auto* layer = layerAt(index);
    return layer ? layer->isVisible() : false;
  }

  void setLayerVisible(int index, bool visible)
  {
    auto* layer = layerAt(index);
    if (layer)
      layer->setVisible(visible);
  }

  int activeLayer() const { return m_activeLayer; }
  int activeFrame() const { return m_activeFrame; }

  void setActiveLayer(int index)
  {
    if (index >= 0 && index < layerCount())
      m_activeLayer = index;
  }

  void setActiveFrame(int frame)
  {
    if (m_sprite && frame >= 0 && frame < (int)m_sprite->totalFrames())
      m_activeFrame = frame;
  }

  void addFrame()
  {
    if (!m_sprite)
      return;
    const doc::frame_t frame = m_sprite->totalFrames();
    m_sprite->addFrame(frame);
    m_activeFrame = (int)frame;

    // Copy previous cel image into new frame for image layers.
    for (doc::Layer* layer : m_sprite->allBrowsableLayers()) {
      if (!layer->isImage())
        continue;
      auto* imgLayer = static_cast<doc::LayerImage*>(layer);
      doc::Cel* prev = imgLayer->cel(frame - 1);
      if (!prev || !prev->image())
        continue;
      doc::ImageRef image(doc::Image::createCopy(prev->image()));
      auto* cel = new doc::Cel(frame, image);
      cel->setPosition(prev->position());
      cel->setOpacity(prev->opacity());
      imgLayer->addCel(cel);
    }
  }

  void addLayer(const std::string& name)
  {
    if (!m_sprite)
      return;
    auto* layer = new doc::LayerImage(m_sprite.get());
    layer->setName(name.empty() ? "Layer" : name);
    m_sprite->root()->addLayer(layer);

    doc::ImageRef image(
      doc::Image::create(m_sprite->pixelFormat(), m_sprite->width(), m_sprite->height()));
    doc::clear_image(image.get(), m_sprite->transparentColor());
    auto* cel = new doc::Cel(0, image);
    layer->addCel(cel);
    m_activeLayer = layerCount() - 1;
  }

  val renderFrame(int frame, bool onionskin)
  {
    if (!m_sprite)
      return val::null();
    if (frame < 0 || frame >= (int)m_sprite->totalFrames())
      frame = m_activeFrame;

    std::unique_ptr<doc::Image> dst(
      doc::Image::create(doc::IMAGE_RGB, m_sprite->width(), m_sprite->height()));
    doc::clear_image(dst.get(), doc::rgba(0, 0, 0, 0));

    render::Render render;
    if (onionskin && frame > 0) {
      render::OnionskinOptions opts(render::OnionskinType::MERGE);
      opts.prevFrames(1);
      opts.nextFrames(0);
      opts.opacityBase(80);
      opts.opacityStep(40);
      render.setOnionskin(opts);
    }
    else {
      render.disableOnionskin();
    }
    render.renderSprite(dst.get(), m_sprite.get(), frame);

    const int w = dst->width();
    const int h = dst->height();
    const size_t nbytes = (size_t)w * h * 4;
    std::vector<uint8_t> rgba(nbytes);
    for (int y = 0; y < h; ++y) {
      const uint8_t* src = dst->getPixelAddress(0, y);
      std::memcpy(rgba.data() + (size_t)y * w * 4, src, (size_t)w * 4);
    }
    val result = val::global("Uint8ClampedArray").new_(nbytes);
    val memory = val(typed_memory_view(nbytes, rgba.data()));
    result.call<void>("set", memory);
    return result;
  }

  val getPalette()
  {
    val colors = val::array();
    if (!m_sprite)
      return colors;
    const doc::Palette* pal = m_sprite->palette(m_activeFrame);
    if (!pal)
      return colors;
    for (int i = 0; i < pal->size(); ++i) {
      const doc::color_t c = pal->getEntry(i);
      val entry = val::object();
      entry.set("r", (int)doc::rgba_getr(c));
      entry.set("g", (int)doc::rgba_getg(c));
      entry.set("b", (int)doc::rgba_getb(c));
      entry.set("a", (int)doc::rgba_geta(c));
      colors.call<void>("push", entry);
    }
    return colors;
  }

  void setPaletteColor(int index, int r, int g, int b, int a)
  {
    if (!m_sprite)
      return;
    doc::Palette* pal = m_sprite->palette(m_activeFrame);
    if (!pal || index < 0 || index >= pal->size())
      return;
    pal->setEntry(index, doc::rgba(r, g, b, a));
  }

  void beginStroke()
  {
    doc::Image* image = activeImage();
    if (!image)
      return;
    m_strokeBefore.reset(doc::Image::createCopy(image));
    m_inStroke = true;
  }

  void endStroke()
  {
    if (!m_inStroke)
      return;
    doc::Image* image = activeImage();
    if (image && m_strokeBefore) {
      auto after = std::unique_ptr<doc::Image>(doc::Image::createCopy(image));
      m_undo->add(new ImageSnapshotCmd(
        activeImageRef(), std::move(m_strokeBefore), std::move(after)));
    }
    m_strokeBefore.reset();
    m_inStroke = false;
  }

  void putPixel(int x, int y, int r, int g, int b, int a)
  {
    doc::Image* image = activeImage();
    if (!image)
      return;
    ensureStroke();
    doc::put_pixel(image, x, y, colorForImage(image, r, g, b, a));
  }

  void drawLine(int x1, int y1, int x2, int y2, int r, int g, int b, int a)
  {
    doc::Image* image = activeImage();
    if (!image)
      return;
    ensureStroke();
    doc::draw_line(image, x1, y1, x2, y2, colorForImage(image, r, g, b, a));
  }

  void drawRect(int x1, int y1, int x2, int y2, int r, int g, int b, int a, bool filled)
  {
    doc::Image* image = activeImage();
    if (!image)
      return;
    ensureStroke();
    const doc::color_t c = colorForImage(image, r, g, b, a);
    if (filled)
      doc::fill_rect(image, x1, y1, x2, y2, c);
    else
      doc::draw_rect(image, x1, y1, x2, y2, c);
  }

  void drawEllipse(int x1, int y1, int x2, int y2, int r, int g, int b, int a, bool filled)
  {
    doc::Image* image = activeImage();
    if (!image)
      return;
    ensureStroke();
    const doc::color_t c = colorForImage(image, r, g, b, a);
    if (filled)
      doc::fill_ellipse(image, x1, y1, x2, y2, 0, 0, c);
    else
      doc::draw_ellipse(image, x1, y1, x2, y2, 0, 0, c);
  }

  void floodFill(int x, int y, int r, int g, int b, int a, int tolerance)
  {
    doc::Image* image = activeImage();
    if (!image)
      return;
    beginStroke();
    const doc::color_t src = doc::get_pixel(image, x, y);
    const doc::color_t dst = colorForImage(image, r, g, b, a);
    struct Ctx {
      doc::Image* image;
      doc::color_t color;
    } ctx{ image, dst };
    doc::algorithm::floodfill(
      image,
      nullptr,
      x,
      y,
      image->bounds(),
      src,
      tolerance,
      true,
      false,
      &ctx,
      [](int x1, int y, int x2, void* data) {
        auto* c = static_cast<Ctx*>(data);
        doc::draw_hline(c->image, x1, y, x2, c->color);
      });
    endStroke();
  }

  val pickColor(int x, int y)
  {
    val result = val::object();
    result.set("r", 0);
    result.set("g", 0);
    result.set("b", 0);
    result.set("a", 0);
    if (!m_sprite)
      return result;

    std::unique_ptr<doc::Image> dst(
      doc::Image::create(doc::IMAGE_RGB, m_sprite->width(), m_sprite->height()));
    render::Render render;
    render.disableOnionskin();
    render.renderSprite(dst.get(), m_sprite.get(), m_activeFrame);
    if (x < 0 || y < 0 || x >= dst->width() || y >= dst->height())
      return result;
    const doc::color_t c = doc::get_pixel(dst.get(), x, y);
    result.set("r", (int)doc::rgba_getr(c));
    result.set("g", (int)doc::rgba_getg(c));
    result.set("b", (int)doc::rgba_getb(c));
    result.set("a", (int)doc::rgba_geta(c));
    return result;
  }

  bool canUndo() const { return m_undo && m_undo->canUndo(); }
  bool canRedo() const { return m_undo && m_undo->canRedo(); }
  void undo()
  {
    if (m_undo && m_undo->canUndo())
      m_undo->undo();
  }
  void redo()
  {
    if (m_undo && m_undo->canRedo())
      m_undo->redo();
  }

  void clearCel()
  {
    doc::Image* image = activeImage();
    if (!image || !m_sprite)
      return;
    beginStroke();
    doc::clear_image(image, m_sprite->transparentColor());
    endStroke();
  }

  int sliceCount() const { return m_sprite ? (int)m_sprite->slices().size() : 0; }

  void addSlice(const std::string& name, int x, int y, int w, int h)
  {
    if (!m_sprite)
      return;
    auto* slice = new doc::Slice();
    slice->setName(name.empty() ? "Slice" : name);
    slice->insert(0, doc::SliceKey(gfx::Rect(x, y, w, h)));
    m_sprite->slices().add(slice);
  }

  val getSlices()
  {
    val arr = val::array();
    if (!m_sprite)
      return arr;
    for (doc::Slice* slice : m_sprite->slices()) {
      val o = val::object();
      o.set("name", slice->name());
      const doc::SliceKey* key = slice->getByFrame(m_activeFrame);
      if (key) {
        o.set("x", key->bounds().x);
        o.set("y", key->bounds().y);
        o.set("w", key->bounds().w);
        o.set("h", key->bounds().h);
      }
      else {
        o.set("x", 0);
        o.set("y", 0);
        o.set("w", 0);
        o.set("h", 0);
      }
      arr.call<void>("push", o);
    }
    return arr;
  }

  int tagCount() const { return m_sprite ? (int)m_sprite->tags().size() : 0; }

  void addTag(const std::string& name, int from, int to)
  {
    if (!m_sprite)
      return;
    auto* tag = new doc::Tag(from, to);
    tag->setName(name.empty() ? "Tag" : name);
    m_sprite->tags().add(tag);
  }

  val getTags()
  {
    val arr = val::array();
    if (!m_sprite)
      return arr;
    for (doc::Tag* tag : m_sprite->tags()) {
      val o = val::object();
      o.set("name", tag->name());
      o.set("from", (int)tag->fromFrame());
      o.set("to", (int)tag->toFrame());
      arr.call<void>("push", o);
    }
    return arr;
  }

  std::string lastError() const { return m_lastError; }
  std::string version() const { return "aseprite-wasm-core/1.0"; }

private:
  void resetSprite(doc::Sprite* sprite)
  {
    m_sprite.reset(sprite);
    m_activeLayer = 0;
    m_activeFrame = 0;
    m_undo = std::make_unique<undo::UndoHistory>();
    m_strokeBefore.reset();
    m_inStroke = false;
    m_lastError.clear();
  }

  doc::Layer* layerAt(int index) const
  {
    if (!m_sprite || index < 0)
      return nullptr;
    const doc::LayerList layers = m_sprite->allBrowsableLayers();
    if (index >= (int)layers.size())
      return nullptr;
    return layers[index];
  }

  doc::Image* activeImage()
  {
    auto ref = activeImageRef();
    return ref.get();
  }

  doc::ImageRef activeImageRef()
  {
    auto* layer = layerAt(m_activeLayer);
    if (!layer || !layer->isImage())
      return doc::ImageRef(nullptr);
    auto* imgLayer = static_cast<doc::LayerImage*>(layer);
    doc::Cel* cel = imgLayer->cel(m_activeFrame);
    if (!cel) {
      doc::ImageRef image(
        doc::Image::create(m_sprite->pixelFormat(), m_sprite->width(), m_sprite->height()));
      doc::clear_image(image.get(), m_sprite->transparentColor());
      cel = new doc::Cel(m_activeFrame, image);
      imgLayer->addCel(cel);
    }
    return cel->imageRef();
  }

  void ensureStroke()
  {
    if (!m_inStroke)
      beginStroke();
  }

  doc::color_t colorForImage(doc::Image* image, int r, int g, int b, int a) const
  {
    switch (image->colorMode()) {
      case doc::ColorMode::INDEXED: {
        const doc::Palette* pal = m_sprite->palette(m_activeFrame);
        if (!pal)
          return 0;
        return pal->findExactMatch(r, g, b, a, -1);
      }
      case doc::ColorMode::GRAYSCALE: {
        const int v = (r * 30 + g * 59 + b * 11) / 100;
        return doc::graya(v, a);
      }
      default: return doc::rgba(r, g, b, a);
    }
  }

  std::unique_ptr<doc::Sprite> m_sprite;
  std::unique_ptr<undo::UndoHistory> m_undo;
  std::unique_ptr<doc::Image> m_strokeBefore;
  bool m_inStroke = false;
  int m_activeLayer = 0;
  int m_activeFrame = 0;
  std::string m_lastError;
};

std::string engineVersion()
{
  return "aseprite-wasm-core/1.0";
}

} // namespace

EMSCRIPTEN_BINDINGS(aseprite_core)
{
  class_<DocumentSession>("DocumentSession")
    .constructor<>()
    .function("newSprite", &DocumentSession::newSprite)
    .function("loadAseprite", &DocumentSession::loadAseprite)
    .function("saveAseprite", &DocumentSession::saveAseprite)
    .function("width", &DocumentSession::width)
    .function("height", &DocumentSession::height)
    .function("colorMode", &DocumentSession::colorMode)
    .function("totalFrames", &DocumentSession::totalFrames)
    .function("frameDuration", &DocumentSession::frameDuration)
    .function("setFrameDuration", &DocumentSession::setFrameDuration)
    .function("layerCount", &DocumentSession::layerCount)
    .function("layerName", &DocumentSession::layerName)
    .function("layerVisible", &DocumentSession::layerVisible)
    .function("setLayerVisible", &DocumentSession::setLayerVisible)
    .function("activeLayer", &DocumentSession::activeLayer)
    .function("activeFrame", &DocumentSession::activeFrame)
    .function("setActiveLayer", &DocumentSession::setActiveLayer)
    .function("setActiveFrame", &DocumentSession::setActiveFrame)
    .function("addFrame", &DocumentSession::addFrame)
    .function("addLayer", &DocumentSession::addLayer)
    .function("renderFrame", &DocumentSession::renderFrame)
    .function("getPalette", &DocumentSession::getPalette)
    .function("setPaletteColor", &DocumentSession::setPaletteColor)
    .function("beginStroke", &DocumentSession::beginStroke)
    .function("endStroke", &DocumentSession::endStroke)
    .function("putPixel", &DocumentSession::putPixel)
    .function("drawLine", &DocumentSession::drawLine)
    .function("drawRect", &DocumentSession::drawRect)
    .function("drawEllipse", &DocumentSession::drawEllipse)
    .function("floodFill", &DocumentSession::floodFill)
    .function("pickColor", &DocumentSession::pickColor)
    .function("canUndo", &DocumentSession::canUndo)
    .function("canRedo", &DocumentSession::canRedo)
    .function("undo", &DocumentSession::undo)
    .function("redo", &DocumentSession::redo)
    .function("clearCel", &DocumentSession::clearCel)
    .function("sliceCount", &DocumentSession::sliceCount)
    .function("addSlice", &DocumentSession::addSlice)
    .function("getSlices", &DocumentSession::getSlices)
    .function("tagCount", &DocumentSession::tagCount)
    .function("addTag", &DocumentSession::addTag)
    .function("getTags", &DocumentSession::getTags)
    .function("lastError", &DocumentSession::lastError)
    .function("version", &DocumentSession::version);

  function("engineVersion", &engineVersion);
}
