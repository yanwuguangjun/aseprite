-- Copyright (C) 2026
--
-- This file is released under the terms of the MIT license.
-- Read LICENSE.txt for more information.
--
-- Tests cross-layer copy/cut/paste of spatial selection content.

dofile('./test_utils.lua')

local function sample_layer_pixel(layer, frame, x, y)
  local cel = layer:cel(frame)
  if not cel or not cel.image then
    return nil
  end
  local px = x - cel.position.x
  local py = y - cel.position.y
  if px < 0 or py < 0 or px >= cel.image.width or py >= cel.image.height then
    return nil
  end
  return cel.image:getPixel(px, py)
end

do
  local spr = Sprite(8, 8, ColorMode.INDEXED)
  local lay1 = spr.layers[1]
  lay1.name = "A"
  local lay2 = spr:newLayer()
  lay2.name = "B"

  -- Paint different pixels on each layer
  app.layer = lay1
  app.useTool {
    tool = "pencil",
    color = Color{ index=1 },
    points = { Point(1, 1), Point(2, 1), Point(1, 2), Point(2, 2) }
  }
  app.layer = lay2
  app.useTool {
    tool = "pencil",
    color = Color{ index=2 },
    points = { Point(1, 1), Point(2, 1), Point(1, 2), Point(2, 2) }
  }

  expect_eq(1, sample_layer_pixel(lay1, 1, 1, 1))
  expect_eq(2, sample_layer_pixel(lay2, 1, 1, 1))

  -- Select both layers + a spatial selection covering the painted area
  app.range.layers = { lay1, lay2 }
  app.layer = lay1
  spr.selection:select(1, 1, 2, 2)

  -- Cut should copy both layers' selection content and clear both
  app.command.Cut()

  expect_eq(nil, sample_layer_pixel(lay1, 1, 1, 1))
  expect_eq(nil, sample_layer_pixel(lay2, 1, 1, 1))

  -- Re-select layers and paste back at the same place
  app.range.layers = { lay1, lay2 }
  app.layer = lay1
  app.command.Paste { x=1, y=1 }
  app.command.DeselectMask()

  expect_eq(1, sample_layer_pixel(lay1, 1, 1, 1))
  expect_eq(1, sample_layer_pixel(lay1, 1, 2, 1))
  expect_eq(2, sample_layer_pixel(lay2, 1, 1, 1))
  expect_eq(2, sample_layer_pixel(lay2, 1, 2, 1))
end

-- Copy (not cut) keeps source layers intact and pastes onto selected layers
do
  local spr = Sprite(4, 4, ColorMode.INDEXED)
  local lay1 = spr.layers[1]
  local lay2 = spr:newLayer()

  app.layer = lay1
  app.useTool {
    tool = "pencil",
    color = Color{ index=3 },
    points = { Point(0, 0), Point(1, 0) }
  }
  app.layer = lay2
  app.useTool {
    tool = "pencil",
    color = Color{ index=4 },
    points = { Point(0, 0), Point(1, 0) }
  }

  app.range.layers = { lay1, lay2 }
  app.layer = lay1
  spr.selection:select(0, 0, 2, 1)
  app.command.Copy()

  -- Sources unchanged
  expect_eq(3, sample_layer_pixel(lay1, 1, 0, 0))
  expect_eq(4, sample_layer_pixel(lay2, 1, 0, 0))

  -- Paste shifted down
  app.range.layers = { lay1, lay2 }
  app.layer = lay1
  app.command.Paste { x=0, y=2 }
  app.command.DeselectMask()

  expect_eq(3, sample_layer_pixel(lay1, 1, 0, 2))
  expect_eq(4, sample_layer_pixel(lay2, 1, 0, 2))
end
