// In-memory FileInterface for WASM I/O (no real filesystem required).
#ifndef EMSCRIPTEN_MEMORY_FILE_INTERFACE_H_INCLUDED
#define EMSCRIPTEN_MEMORY_FILE_INTERFACE_H_INCLUDED
#pragma once

#include "dio/file_interface.h"

#include <cstdint>
#include <cstring>
#include <vector>

namespace wasm {

class MemoryFileInterface : public dio::FileInterface {
public:
  MemoryFileInterface() = default;
  explicit MemoryFileInterface(std::vector<uint8_t> data) : m_data(std::move(data)) {}

  bool ok() const override { return m_ok; }
  size_t tell() override { return m_pos; }

  void seek(size_t absPos) override
  {
    m_pos = absPos;
    if (m_pos > m_data.size())
      m_data.resize(m_pos);
  }

  uint8_t read8() override
  {
    if (m_pos >= m_data.size()) {
      m_ok = false;
      return 0;
    }
    return m_data[m_pos++];
  }

  size_t readBytes(uint8_t* buf, size_t n) override
  {
    if (!buf || n == 0)
      return 0;
    const size_t available = (m_pos < m_data.size()) ? (m_data.size() - m_pos) : 0;
    const size_t toRead = (n < available) ? n : available;
    if (toRead > 0) {
      std::memcpy(buf, m_data.data() + m_pos, toRead);
      m_pos += toRead;
    }
    if (toRead < n)
      m_ok = false;
    return toRead;
  }

  void write8(uint8_t value) override
  {
    if (m_pos >= m_data.size())
      m_data.resize(m_pos + 1);
    m_data[m_pos++] = value;
  }

  size_t writeBytes(uint8_t* buf, size_t n) override
  {
    if (!buf || n == 0)
      return 0;
    if (m_pos + n > m_data.size())
      m_data.resize(m_pos + n);
    std::memcpy(m_data.data() + m_pos, buf, n);
    m_pos += n;
    return n;
  }

  const std::vector<uint8_t>& data() const { return m_data; }
  std::vector<uint8_t>& data() { return m_data; }

private:
  std::vector<uint8_t> m_data;
  size_t m_pos = 0;
  bool m_ok = true;
};

} // namespace wasm

#endif
