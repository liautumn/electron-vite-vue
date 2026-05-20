import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLuodanFrame,
  estimatePhaseDistanceCm,
  estimatePhaseDistanceMeters,
  estimateRelativePhaseDistanceCm,
  parseLuodanFrame,
  parseLuodanInventoryMessage,
  resolveLuodanFrequencyMHz,
  splitLuodanFrames
} from '../src/components/rfid/luodan/LuodanCommon.ts'

describe('LuodanCommon', () => {
  it('builds 0x8B phase inventory frames with two-complement checksum', () => {
    const frame = buildLuodanFrame(0x8b, '01 00 00 01 01')

    assert.equal(frame, 'A008FF8B0100000101CB')
  })

  it('buffers incomplete callback data until a full A0 frame arrives', () => {
    const first = splitLuodanFrames('', 'A008FF8B0100')
    assert.deepEqual(first.frames, [])
    assert.equal(first.buffer, 'A008FF8B0100')

    const second = splitLuodanFrames(first.buffer, '000101CB')
    assert.deepEqual(second.frames, ['A008FF8B0100000101CB'])
    assert.equal(second.buffer, '')
  })

  it('parses a phase-enabled 0x8B tag callback with variable EPC length', () => {
    const frame = buildLuodanFrame(
      0x8b,
      '02 3000 112233445566778899AABBCC 5A 03E8'
    )
    const message = parseLuodanInventoryMessage(frame, { phaseEnabled: true })

    assert.equal(message?.type, 'tag')
    if (message?.type !== 'tag') return
    assert.equal(message.tag.epc, '112233445566778899AABBCC')
    assert.equal(message.tag.pc, '3000')
    assert.equal(message.tag.antennaId, 3)
    assert.equal(message.tag.frequencyParameter, 0)
    assert.equal(message.tag.frequencyMHz, 865)
    assert.equal(message.tag.rssi.value, 0x5a)
    assert.equal(message.tag.phase?.raw, 1000)
    assert.equal(message.tag.phase?.degrees, 87.89)
  })

  it('maps luodan frequency parameters to MHz according to the manual table', () => {
    assert.equal(resolveLuodanFrequencyMHz(0), 865)
    assert.equal(resolveLuodanFrequencyMHz(6), 868)
    assert.equal(resolveLuodanFrequencyMHz(7), 902)
    assert.equal(resolveLuodanFrequencyMHz(33), 915)
    assert.equal(resolveLuodanFrequencyMHz(59), 928)
    assert.equal(resolveLuodanFrequencyMHz(60), null)
  })

  it('parses frequency parameter and MHz from the FreqAnt high 6 bits', () => {
    const frame = buildLuodanFrame(
      0x8b,
      '84 3000 112233445566778899AABBCC 5A 008C'
    )
    const message = parseLuodanInventoryMessage(frame, { phaseEnabled: true })

    assert.equal(message?.type, 'tag')
    if (message?.type !== 'tag') return
    assert.equal(message.tag.antennaId, 1)
    assert.equal(message.tag.frequencyParameter, 33)
    assert.equal(message.tag.frequencyMHz, 915)
  })

  it('parses a 0x8B inventory completion frame separately from tag callbacks', () => {
    const frame = buildLuodanFrame(0x8b, '01 0008 00000003')
    const message = parseLuodanInventoryMessage(frame, { phaseEnabled: true })

    assert.deepEqual(message, {
      type: 'done',
      address: 0xff,
      command: 0x8b,
      antennaId: 2,
      readRate: 8,
      totalRead: 3,
      rawFrame: frame
    })
  })

  it('validates checksum while parsing luodan frames', () => {
    assert.throws(
      () => parseLuodanFrame('A008FF8B0100000101CC'),
      /校验和错误/
    )
  })

  it('estimates modulo phase distance using the configured carrier frequency', () => {
    const distance = estimatePhaseDistanceMeters(2048, 915)

    assert.equal(distance, 0.0819)
  })

  it('estimates modulo phase distance in centimeters', () => {
    const distance = estimatePhaseDistanceCm(2048, 915)

    assert.equal(distance, 8.19)
  })

  it('estimates signed relative phase distance in centimeters', () => {
    assert.equal(estimateRelativePhaseDistanceCm(150, 100, 915), 0.2)
    assert.equal(estimateRelativePhaseDistanceCm(10, 4090, 915), 0.06)
    assert.equal(estimateRelativePhaseDistanceCm(4090, 10, 915), -0.06)
  })
})
