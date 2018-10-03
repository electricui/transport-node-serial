import 'mocha'

import * as chai from 'chai'
import * as sinon from 'sinon'

import { Connection, ConnectionInterface, Sink, Source } from '@electricui/core'

import SerialTransport from '../src/transport'

const SerialPort = require('serialport/test')
const MockBinding = SerialPort.Binding

const assert = chai.assert

const portPath = 'test'

const options = {
  comPath: portPath,
  baudRate: 115200,
  SerialPort: SerialPort,
  highWaterMark: 100, // 100 byte watermark
}

MockBinding.createPort(portPath, { echo: true, record: true })

class TestSink extends Sink {
  callback: (chunk: any) => void
  constructor(callback: (chunk: any) => void) {
    super()
    this.callback = callback
  }

  async receive(chunk: any) {
    return this.callback(chunk)
  }
}

const factory = (options: any) => {
  const connectionInterface = new ConnectionInterface()
  const connection = new Connection({ connectionInterface })

  const transport = new SerialTransport(options)
  connectionInterface.setTransport(transport)

  const spy = sinon.spy()

  const callback = (data: any) => {
    spy(data)
  }

  const sink = new TestSink(callback)

  transport.readPipeline.pipe(sink)

  const writePipeline = <Sink>transport.writePipeline

  const source = new Source()
  source.pipe(writePipeline)

  return {
    source,
    transport,
    spy,
  }
}

describe('Node Serial Transport', () => {
  it('Can connect and write', async () => {
    const { source, transport, spy } = factory(options)

    await transport.connect()

    const chunk = Buffer.from('test')

    await source.push(chunk)

    const binding = <any>transport.serialPort.binding

    assert.deepEqual(chunk, binding.lastWrite)
  })
  it('Can connect and write and receive', async () => {
    const { source, transport, spy } = factory(options)

    await transport.connect()

    const chunk = Buffer.from('test')

    await source.push(chunk)

    assert.isTrue(spy.called)
  })
  it('Can connect and write and receive and disconnect', async () => {
    const { source, transport, spy } = factory(options)

    await transport.connect()

    const chunk = Buffer.from('test')

    await source.push(chunk)

    assert.isTrue(spy.called)

    await transport.disconnect()

    assert.isFalse(transport.serialPort.isOpen)
  })
  it('Pauses the transport when reaching the high watermark and unpauses it after drain', async () => {
    const { source, transport, spy } = factory(options)

    await transport.connect()

    const chunk = Buffer.from(Array(200).join('x'))

    await source.push(chunk)
    const writePromise = source.push(chunk)

    const a = <ConnectionInterface>transport.connectionInterface
    const b = <Connection>a.connection

    assert.isTrue(b.paused)

    await writePromise

    assert.isFalse(b.paused)
  })
})
