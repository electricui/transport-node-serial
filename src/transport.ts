import * as Stream from 'stream'

import { Sink, Transport } from '@electricui/core'

import { SerialPort } from './serialport-types'

export interface ISerialPort {
  new (comPath: string, options: SerialPort.OpenOptions): SerialPort
}

export interface SerialTransportOptions {
  comPath: string
  baudRate: number
  SerialPort: ISerialPort
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
  serialPort: SerialPort

  constructor(options: SerialTransportOptions) {
    super(options)

    const { SerialPort: SerialPortClass, comPath, ...rest } = options

    this.writeToDevice = this.writeToDevice.bind(this)

    this.writePipeline = new SerialWriteSink(this.writeToDevice)

    this.receiveData = this.receiveData.bind(this)
    this.error = this.error.bind(this)
    this.close = this.close.bind(this)

    this.serialPort = new SerialPortClass(comPath, {
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
    this.readPipeline.push(chunk)
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.serialPort.open(err => {
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
        this.serialPort.close(err => {
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
