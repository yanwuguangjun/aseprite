# Aseprite WebAssembly Core
# Standalone Emscripten project: doc/render/dio/filters + embind API.

cmake_minimum_required(VERSION 3.20)
project(aseprite_wasm C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure with: emcmake cmake -S emscripten -B build-wasm")
endif()

set(ASEPRITE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")
list(APPEND CMAKE_MODULE_PATH "${ASEPRITE_ROOT}/cmake")

set(ENABLE_SCRIPTING OFF CACHE BOOL "" FORCE)
set(ENABLE_WEBSOCKET OFF CACHE BOOL "" FORCE)
set(ENABLE_NEWS OFF CACHE BOOL "" FORCE)
set(ENABLE_UPDATER OFF CACHE BOOL "" FORCE)
set(ENABLE_STEAM OFF CACHE BOOL "" FORCE)
set(ENABLE_SENTRY OFF CACHE BOOL "" FORCE)
set(ENABLE_DRM OFF CACHE BOOL "" FORCE)
set(ENABLE_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(ENABLE_ASEPRITE_EXE OFF CACHE BOOL "" FORCE)
set(ENABLE_DESKTOP_INTEGRATION OFF CACHE BOOL "" FORCE)
set(ENABLE_WEBP OFF CACHE BOOL "" FORCE)
set(ENABLE_PSD OFF CACHE BOOL "" FORCE)
set(ENABLE_CCACHE OFF CACHE BOOL "" FORCE)
set(ENABLE_DEVMODE OFF CACHE BOOL "" FORCE)
set(REQUIRE_CURL OFF)
set(LAF_BACKEND "none" CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF)

set(ZLIB_DIR       "${ASEPRITE_ROOT}/third_party/zlib")
set(LIBPNG_DIR     "${ASEPRITE_ROOT}/third_party/libpng")
set(GIFLIB_DIR     "${ASEPRITE_ROOT}/third_party/giflib")
set(PIXMAN_DIR     "${ASEPRITE_ROOT}/third_party/pixman")
set(TINYXML_DIR    "${ASEPRITE_ROOT}/third_party/tinyxml2")
set(TINYEXIF_DIR   "${ASEPRITE_ROOT}/third_party/TinyEXIF")
set(SIMPLEINI_DIR  "${ASEPRITE_ROOT}/third_party/simpleini")
set(LAF_LIST_DIR   "${ASEPRITE_ROOT}/laf")
set(LAF_BINARY_DIR "${CMAKE_BINARY_DIR}/laf")

add_definitions(-DNDEBUG)
add_definitions(-DPNG_NO_MMX_CODE)
add_definitions(-Wno-sign-compare)

include_directories("${SIMPLEINI_DIR}")

# Applied only to Aseprite/laf targets (third_party must not see src/config.h)
set(ASE_CORE_INCLUDES "${ASEPRITE_ROOT}/src")

# ---------------- third_party (minimal) ----------------
set(SKIP_INSTALL_ALL ON)
set(ZLIB_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ZLIB_ROOT "${ZLIB_DIR}" CACHE INTERNAL "")
add_subdirectory("${ASEPRITE_ROOT}/third_party/zlib" "${CMAKE_BINARY_DIR}/third_party/zlib")
add_library(ZLIB::ZLIB ALIAS zlibstatic)
set(ZLIB_FOUND ON)
set(ZLIB_LIBRARY zlibstatic)
set(ZLIB_LIBRARIES zlibstatic)
set(ZLIB_INCLUDE_DIRS ${ZLIB_DIR} ${CMAKE_BINARY_DIR}/third_party/zlib)
set(ZLIB_INCLUDE_DIR ${ZLIB_INCLUDE_DIRS} CACHE PATH "" FORCE)
set(ZLIB_LIBRARY zlibstatic CACHE FILEPATH "" FORCE)
include_directories(${ZLIB_INCLUDE_DIRS})

set(PNG_SHARED OFF CACHE BOOL "" FORCE)
set(PNG_STATIC ON CACHE BOOL "" FORCE)
set(PNG_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory("${ASEPRITE_ROOT}/third_party/libpng" "${CMAKE_BINARY_DIR}/third_party/libpng")
set(PNG_FOUND ON)
set(PNG_LIBRARY png_static)
set(PNG_LIBRARIES png_static)
set(PNG_INCLUDE_DIRS ${LIBPNG_DIR} ${CMAKE_BINARY_DIR}/third_party/libpng)
include_directories(${PNG_INCLUDE_DIRS})

set(GIFLIB_UTILS OFF CACHE BOOL "" FORCE)
add_subdirectory("${ASEPRITE_ROOT}/third_party/giflib" "${CMAKE_BINARY_DIR}/third_party/giflib")
set(GIF_LIBRARY giflib)
set(GIF_LIBRARIES giflib)
set(GIF_INCLUDE_DIRS ${GIFLIB_DIR})
include_directories(${GIF_INCLUDE_DIRS})

add_subdirectory("${ASEPRITE_ROOT}/third_party/pixman-cmake" "${CMAKE_BINARY_DIR}/third_party/pixman")
set(PIXMAN_LIBRARY pixman)
set(PIXMAN_INCLUDE_DIR ${PIXMAN_DIR}/pixman ${CMAKE_BINARY_DIR})
include_directories(${PIXMAN_INCLUDE_DIR})

set(tinyxml2_BUILD_TESTING OFF CACHE BOOL "" FORCE)
add_subdirectory("${ASEPRITE_ROOT}/third_party/tinyxml2" "${CMAKE_BINARY_DIR}/third_party/tinyxml2")
include_directories(${TINYXML_DIR})

set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(BUILD_DEMO OFF CACHE BOOL "" FORCE)
add_subdirectory("${ASEPRITE_ROOT}/third_party/TinyEXIF" "${CMAKE_BINARY_DIR}/third_party/TinyEXIF")
include_directories(${TINYEXIF_DIR})

add_subdirectory("${ASEPRITE_ROOT}/third_party/fmt" "${CMAKE_BINARY_DIR}/third_party/fmt")
add_subdirectory("${ASEPRITE_ROOT}/third_party/cityhash" "${CMAKE_BINARY_DIR}/third_party/cityhash")
add_subdirectory("${ASEPRITE_ROOT}/third_party/json11" "${CMAKE_BINARY_DIR}/third_party/json11")
add_subdirectory("${ASEPRITE_ROOT}/third_party/simpleini" "${CMAKE_BINARY_DIR}/third_party/simpleini")
add_library(qoi INTERFACE)
target_include_directories(qoi INTERFACE "${ASEPRITE_ROOT}/third_party/qoi")

# ---------------- laf-base + laf-gfx (no os/skia/clip) ----------------
include(CheckIncludeFiles)
include(CheckFunctionExists)
include(CheckCXXSourceCompiles)
include(TestBigEndian)

check_include_files(stdint.h HAVE_STDINT_H)
check_include_files(dlfcn.h HAVE_DLFCN_H)
check_function_exists(sched_yield HAVE_SCHED_YIELD)
set(HAVE_SYSTEM FALSE)
test_big_endian(LAF_BIG_ENDIAN)
if(NOT LAF_BIG_ENDIAN)
  set(LAF_LITTLE_ENDIAN TRUE)
endif()

file(MAKE_DIRECTORY "${LAF_BINARY_DIR}/base")
configure_file(
  "${LAF_LIST_DIR}/base/config.h.cmakein"
  "${LAF_BINARY_DIR}/base/config.h"
  @ONLY)

set(LAF_BASE_DIR "${LAF_LIST_DIR}/base")
add_library(laf-base
  ${LAF_BASE_DIR}/base64.cpp
  ${LAF_BASE_DIR}/cfile.cpp
  ${LAF_BASE_DIR}/chrono.cpp
  ${LAF_BASE_DIR}/convert_to.cpp
  ${LAF_BASE_DIR}/debug.cpp
  ${LAF_BASE_DIR}/dll.cpp
  ${LAF_BASE_DIR}/errno_string.cpp
  ${LAF_BASE_DIR}/exception.cpp
  ${LAF_BASE_DIR}/file_content.cpp
  ${LAF_BASE_DIR}/file_handle.cpp
  ${LAF_BASE_DIR}/fs.cpp
  ${LAF_BASE_DIR}/launcher.cpp
  ${LAF_BASE_DIR}/log.cpp
  ${LAF_BASE_DIR}/mem_utils.cpp
  ${LAF_BASE_DIR}/memory.cpp
  ${LAF_BASE_DIR}/memory_dump.cpp
  ${LAF_BASE_DIR}/platform.cpp
  ${LAF_BASE_DIR}/process.cpp
  ${LAF_BASE_DIR}/program_options.cpp
  ${LAF_BASE_DIR}/replace_string.cpp
  ${LAF_BASE_DIR}/rw_lock.cpp
  ${LAF_BASE_DIR}/serialization.cpp
  ${LAF_BASE_DIR}/sha1.cpp
  ${LAF_BASE_DIR}/sha1_rfc3174.c
  ${LAF_BASE_DIR}/split_string.cpp
  ${LAF_BASE_DIR}/string.cpp
  ${LAF_BASE_DIR}/system_console.cpp
  ${LAF_BASE_DIR}/task.cpp
  ${LAF_BASE_DIR}/thread.cpp
  ${LAF_BASE_DIR}/thread_pool.cpp
  ${LAF_BASE_DIR}/time.cpp
  ${LAF_BASE_DIR}/version.cpp
  ${LAF_BASE_DIR}/platform_unix.cpp
  ${LAF_BASE_DIR}/uuid_unix.cpp
)
target_include_directories(laf-base PUBLIC ${LAF_LIST_DIR} ${LAF_BINARY_DIR} ${ASE_CORE_INCLUDES})
target_compile_definitions(laf-base PUBLIC LAF_LINUX LAF_EMSCRIPTEN HAVE_CONFIG_H)

set(LAF_GFX_DIR "${LAF_LIST_DIR}/gfx")
add_library(laf-gfx
  ${LAF_GFX_DIR}/color_space.cpp
  ${LAF_GFX_DIR}/hsl.cpp
  ${LAF_GFX_DIR}/hsv.cpp
  ${LAF_GFX_DIR}/rgb.cpp
  ${LAF_GFX_DIR}/packing_rects.cpp
  ${LAF_GFX_DIR}/region_pixman.cpp
)
target_link_libraries(laf-gfx PUBLIC laf-base ${PIXMAN_LIBRARY})
target_include_directories(laf-gfx PRIVATE ${PIXMAN_INCLUDE_DIR})
target_compile_definitions(laf-gfx PUBLIC LAF_WITH_REGION LAF_PIXMAN)

# ---------------- core aseprite libs ----------------
set(OBSERVABLE_TESTS OFF CACHE BOOL "" FORCE)
set(OBSERVABLE_FAST_LIST ON CACHE BOOL "" FORCE)
add_subdirectory("${ASEPRITE_ROOT}/src/observable" "${CMAKE_BINARY_DIR}/src/observable")
include_directories("${ASEPRITE_ROOT}/src/observable")

set(UNDO_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory("${ASEPRITE_ROOT}/src/undo" "${CMAKE_BINARY_DIR}/src/undo")

add_subdirectory("${ASEPRITE_ROOT}/src/cfg" "${CMAKE_BINARY_DIR}/src/cfg")
add_subdirectory("${ASEPRITE_ROOT}/src/fixmath" "${CMAKE_BINARY_DIR}/src/fixmath")
add_subdirectory("${ASEPRITE_ROOT}/src/flic" "${CMAKE_BINARY_DIR}/src/flic")
add_subdirectory("${ASEPRITE_ROOT}/src/tga" "${CMAKE_BINARY_DIR}/src/tga")
add_subdirectory("${ASEPRITE_ROOT}/src/doc" "${CMAKE_BINARY_DIR}/src/doc")
add_subdirectory("${ASEPRITE_ROOT}/src/view" "${CMAKE_BINARY_DIR}/src/view")
add_subdirectory("${ASEPRITE_ROOT}/src/filters" "${CMAKE_BINARY_DIR}/src/filters")
add_subdirectory("${ASEPRITE_ROOT}/src/render" "${CMAKE_BINARY_DIR}/src/render")
add_subdirectory("${ASEPRITE_ROOT}/src/dio" "${CMAKE_BINARY_DIR}/src/dio")
add_subdirectory("${ASEPRITE_ROOT}/src/ver" "${CMAKE_BINARY_DIR}/src/ver")

# ---------------- wasm module ----------------
add_executable(aseprite_core
  bindings/embind_core.cpp
  stubs/memory_file_interface.cpp
)
target_include_directories(aseprite_core PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${CMAKE_CURRENT_SOURCE_DIR}/stubs"
  "${CMAKE_CURRENT_SOURCE_DIR}/bindings"
)
target_link_libraries(aseprite_core
  dio-lib
  render-lib
  filters-lib
  view-lib
  doc-lib
  flic-lib
  tga-lib
  fixmath-lib
  cfg-lib
  undo
  obs
  laf-gfx
  laf-base
  fmt
  cityhash
  ${ZLIB_LIBRARIES}
  ${PNG_LIBRARIES}
  ${GIF_LIBRARIES}
)

set(EM_LINK_FLAGS
  "-O2 -lembind -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAsepriteCore -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=5242880 -sDISABLE_EXCEPTION_CATCHING=0 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=['FS','UTF8ToString','HEAPU8']"
)
set_target_properties(aseprite_core PROPERTIES
  OUTPUT_NAME "aseprite_core"
  SUFFIX ".js"
  LINK_FLAGS "${EM_LINK_FLAGS}"
)

set(WEB_OUT "${ASEPRITE_ROOT}/web/public/aseprite")
add_custom_command(TARGET aseprite_core POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${WEB_OUT}"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:aseprite_core>" "${WEB_OUT}/aseprite_core.js"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "${CMAKE_CURRENT_BINARY_DIR}/aseprite_core.wasm" "${WEB_OUT}/aseprite_core.wasm"
)
