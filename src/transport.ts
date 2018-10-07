import * as Stream from 'stream'

import { Sink, Transport } from '@electricui/core'

const dTransport = require('debug')(
  'electricui-transport-node-serial:transport',
)

/*
export interface ISerialPort {
  new (comPath: string, options: SerialPort.OpenOptions): SerialPort
}
*/
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

  constructor(options: SerialTransportOptions) {
    super(options)

    const { SerialPort, comPath, ...rest } = options

    this.writeToDevice = this.writeToDevice.bind(this)

    this.writePipeline = new SerialWriteSink(this.writeToDevice)

    this.receiveData = this.receiveData.bind(this)
    this.error = this.error.bind(this)
    this.close = this.close.bind(this)

    this.serialPort = new SerialPort(comPath, {
      ...rest,
      autoOpen: false,
      lock: false,
    })

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

  receiveData(chunk: any) {
    dTransport('received raw serial data', chunk)

    this.readPipeline.push(chunk)
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.serialPort.open((err: Error) => {
        if (err) {
          reject(err)
          return
        }

        resolve()
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

          resolve()
        })
      })
    }
    return Promise.resolve()
  }

  writeToDevice(chunk: any) {
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
