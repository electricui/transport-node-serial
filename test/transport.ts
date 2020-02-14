import 'mocha'

import * as chai from 'chai'
import * as sinon from 'sinon'

import {
  Connection,
  ConnectionInterface,
  DeliverabilityManagerDumb,
  DeviceManager,
  QueryManagerNone,
  Sink,
  Source,
} from '@electricui/core'

import { SerialTransport } from '../src/transport'

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

  const deliverabilityManager = new DeliverabilityManagerDumb(
    connectionInterface,
  )
  connectionInterface.setDeliverabilityManager(deliverabilityManager)

  const queryManager = new QueryManagerNone(connectionInterface)
  connectionInterface.setQueryManager(queryManager)

  const transport = new SerialTransport(options)
  connectionInterface.setTransport(transport)

  const spy = sinon.spy()

  const callback = (data: any) => {
    spy(data)
  }

  const sink = new TestSink(callback)

  const writePipeline = <Sink>transport.writePipeline

  const source = new Source()
  source.pipe(writePipeline)

  connectionInterface.finalise()

  // Pipe the transports read pipeline into our sink
  transport.readPipeline.pipe(sink)

  // set up the connection
  const deviceManager = new DeviceManager()

  const connection = new Connection({
    connectionInterface,
    connectionStateUpdateCallback: (connection: Connection) => {},
    connectionUsageRequestUpdateCallback: (connection: Connection) => {},
    deviceManager,
  })

  return {
    source,
    transport,
    spy,
    connection,
  }
}

describe('Node Serial Transport', () => {
  it('Can connect and write', async () => {
    const { source, transport, spy } = factory(options)

    await transport.connect()

    const chunk = Buffer.from('test')

    await source.push(chunk)

    const binding = transport.serialPort.binding as any

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

    assert.isTrue(spy.called, 'Expected the transport to have been written to')

    await transport.disconnect()

    assert.isFalse(
      transport.serialPort.isOpen,
      'Expected the serialport to be disconnected',
    )
  })
  it('Pauses the transport when reaching the high watermark and unpauses it after drain', async () => {
    const { source, transport, connection } = factory(options)

    await transport.connect()

    const chunk = Buffer.from(Array(200).join('x'))

    await source.push(chunk)
    const writePromise = source.push(chunk)

    assert.isTrue(connection.paused)

    await writePromise

    assert.isFalse(connection.paused)
  })
})
