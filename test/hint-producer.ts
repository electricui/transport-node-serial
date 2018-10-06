import 'mocha'

import * as chai from 'chai'
import * as sinon from 'sinon'

import {
  Connection,
  ConnectionInterface,
  DeviceManager,
  DiscoveryHintTransformer,
  Hint,
  Sink,
  Source,
} from '@electricui/core'

import SerialPortHintProducer from '../src/hint-producer'

const delay = (time: number) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, time)
  })
}

const SerialPort = require('serialport/test')
const MockBinding = SerialPort.Binding

const assert = chai.assert

const portPath = 'test'

const options = {
  SerialPort: SerialPort,
}

MockBinding.createPort(portPath, { echo: true, record: true })

type TransformCallback = (hint: Hint) => void

class TestTransformer extends DiscoveryHintTransformer {
  callback: TransformCallback

  constructor(callback: TransformCallback) {
    super()
    this.callback = callback
  }

  canTransform(hint: Hint): boolean {
    return true
  }

  transform(hint: Hint) {
    this.callback(hint)
    return hint
  }
}

function factory() {
  const spy = sinon.spy()

  const deviceManager = new DeviceManager()

  const producer = new SerialPortHintProducer(options)

  deviceManager.addHintProducers([producer])

  let callback: () => void

  let transformer = new TestTransformer((hint: Hint) => {
    spy(hint)
    callback()
  })

  const hintReceived = new Promise((resolve, reject) => {
    callback = resolve
  })

  deviceManager.addHintTransformers([transformer])

  return {
    spy,
    deviceManager,
    hintReceived,
  }
}

describe('Node Serial Hint Producer', () => {
  it('Produces hints based on the available serial ports', async () => {
    const { spy, deviceManager, hintReceived } = factory()

    await deviceManager.poll()

    await hintReceived

    assert.isTrue(spy.called)
  })
  it("Doesn't report hints if the polling is stopped", async () => {
    const { spy, deviceManager, hintReceived } = factory()

    deviceManager.poll()

    assert.isFalse(spy.called)

    // immediately stop polling
    deviceManager.stopPolling()

    assert.isFalse(spy.called)

    await delay(30)

    assert.isFalse(spy.called)
  })
})
