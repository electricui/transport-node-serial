import { Sink, Transport } from '@electricui/core'

const dTransport = require('debug')(
  'electricui-transport-node-serial:transport',
)

export interface SerialTransportOptions {
  comPath: string
  baudRate: number
  SerialPort: any
  autoOpen?: false
  lock?: false
}

class SerialWriteSink extends Sink {
  callback: (chunk: any) => Promise<any>

  constructor(callback: (chunk: any) => Promise<any>) {
    super()
    this.callback = callback
  }

  receive(chunk: any) {
    return this.callback(chunk)
  }
}

export default class SerialTransport extends Transport {
  serialPort: any
  inboundByteCounter: number = 0
  outboundByteCounter: number = 0
  /**
   * Used as an escape hatch in hint-validator-binary-handshake in order to assign devices
   * with the same boardID (because of a developer mistake) unique deviceIDs.
   */
  isSerialTransport = true as const
  public comPath = ''

  constructor(options: SerialTransportOptions) {
    super(options)

    const { SerialPort, comPath, ...rest } = options

    this.writeToDevice = this.writeToDevice.bind(this)

    this.writePipeline = new SerialWriteSink(this.writeToDevice)

    this.receiveData = this.receiveData.bind(this)
    this.error = this.error.bind(this)
    this.close = this.close.bind(this)
    this.resetBandwidthCounters = this.resetBandwidthCounters.bind(this)
    this.getOutboundBandwidthCounter = this.getOutboundBandwidthCounter.bind(
      this,
    )
    this.getInboundBandwidthCounter = this.getInboundBandwidthCounter.bind(this)

    this.serialPort = new SerialPort(comPath, {
      ...rest,
      autoOpen: false,
      lock: false,
    })

    // Used by hint-validator-binary-handshake
    this.comPath = comPath

    this.serialPort.on('error', this.error)
    this.serialPort.on('data', this.receiveData)
    this.serialPort.on('close', this.close)
  }

  error(err: Error) {
    this.onError(err)
  }

  close(err: Error) {
    this.onClose(err)
  }

  receiveData(chunk: Buffer) {
    dTransport('received raw serial data', chunk)

    this.inboundByteCounter += chunk.byteLength

    this.readPipeline.push(chunk).catch(err => {
      console.warn('Could not parse part of chunk', err, 'inside', chunk)
    })
  }

  resetBandwidthCounters() {
    this.inboundByteCounter = 0
    this.outboundByteCounter = 0
  }

  getOutboundBandwidthCounter() {
    return this.outboundByteCounter
  }

  getInboundBandwidthCounter() {
    return this.inboundByteCounter
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.serialPort.open((err: Error) => {
        if (err) {
          reject(err)
          return
        }

        resolve()

        this.resetBandwidthCounters()
      })
    })
  }

  disconnect() {
    if (this.serialPort.isOpen) {
      return new Promise((resolve, reject) => {
        this.serialPort.close((err: Error) => {
          if (err) {
            reject(err)
            return
          }

          this.resetBandwidthCounters()

          resolve()
        })
      })
    }
    return Promise.resolve()
  }

  writeToDevice(chunk: Buffer) {
    dTransport('writing raw serial data', chunk)

    return new Promise((resolve, reject) => {
      // check if we can continue
      const canContinue = this.serialPort.write(chunk, (err: Error) => {
        if (err) {
          reject(err)
          return
        }
      })

      // don't return this promise until the OS has drained it's buffer
      this.serialPort.drain((err: Error) => {
        if (err) {
          reject(err)
          return
        }

        this.outboundByteCounter += chunk.byteLength

        resolve()
      })

      // if we can't continue, pause the transport until the drain event
      if (!canContinue) {
        this.pause()
        this.serialPort.once('drain', () => {
          this.resume()
        })
      }
    })
  }
}
