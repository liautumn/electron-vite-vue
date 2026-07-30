class SenseVoicePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunkSize = 4096
    this.buffer = new Float32Array(this.chunkSize)
    this.offset = 0
    this.squareSum = 0
    this.port.onmessage = (event) => {
      if (event.data === 'flush') this.flush()
    }
  }

  emitChunk() {
    if (!this.offset) return
    const samples = this.offset === this.buffer.length
      ? this.buffer
      : this.buffer.slice(0, this.offset)
    const rms = Math.sqrt(this.squareSum / this.offset)
    this.port.postMessage({samples, rms}, [samples.buffer])
    this.buffer = new Float32Array(this.chunkSize)
    this.offset = 0
    this.squareSum = 0
  }

  flush() {
    this.emitChunk()
    this.port.postMessage({flushed: true})
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length) return true

    const frameLength = channels[0].length
    for (let frame = 0; frame < frameLength; frame += 1) {
      let sample = 0
      for (let channel = 0; channel < channels.length; channel += 1) {
        sample += channels[channel][frame] || 0
      }
      sample /= channels.length
      this.buffer[this.offset] = sample
      this.squareSum += sample * sample
      this.offset += 1
      if (this.offset === this.chunkSize) this.emitChunk()
    }
    return true
  }
}

registerProcessor('sensevoice-pcm', SenseVoicePcmProcessor)
