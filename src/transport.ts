import { CancellationToken, Sink, Transport } from '@electricui/core'
import { OpenOptions, default as SerialPortNamespace, SetOptions } from 'serialport'
import { mark, measure } from './perf'

import debug from 'debug'

const dTransport = debug('electricui-transport-node-serial:transport')

export interface SerialTransportOptions extends OpenOptions {
  comPath: string
  SerialPort: typeof SerialPortNamespace
  /**
   * Arduinos are garbage so wait a certain period of time before reporting that a connection is open
   */
  attachmentDelay?: number
  onAttachmentPortSettings?: SetOptions
}

const onAttachmentPortSettingsDefault: SetOptions = {
  rts: false,
}

class SerialWriteSink extends Sink {
  callback: (chunk: any, cancellationToken: CancellationToken) => Promise<any>

  constructor(callback: (chunk: any, cancellationToken: CancellationToken) => Promise<any>) {
    super()
    this.callback = callback
  }

  receive(chunk: any, cancellationToken: CancellationToken) {
    return this.callback(chunk, cancellationToken)
  }
}

export class SerialTransport extends Transport {
  serialPort: SerialPortNamespace
  inboundByteCounter: number = 0
  outboundByteCounter: number = 0
  /**
   * Used as an escape hatch in hint-validator-binary-handshake in order to assign devices
   * with the same boardID (because of a developer mistake) unique deviceIDs.
   */
  isSerialTransport = true as const
  attachmentDelay: number
  onAttachmentPortSettings: SetOptions
  public comPath = ''

  constructor(options: SerialTransportOptions) {
    super()

    const { SerialPort, comPath, attachmentDelay, onAttachmentPortSettings, ...rest } = options

    if (!comPath) {
      throw new Error('The SerialTransport needs a comPath passed to it.')
    }

    this.attachmentDelay = attachmentDelay ?? 0 // no delay by default
    this.writeToDevice = this.writeToDevice.bind(this)

    this.writePipeline = new SerialWriteSink(this.writeToDevice)

    this.receiveData = this.receiveData.bind(this)
    this.error = this.error.bind(this)
    this.close = this.close.bind(this)
    this.resetBandwidthCounters = this.resetBandwidthCounters.bind(this)
    this.getOutboundBandwidthCounter = this.getOutboundBandwidthCounter.bind(this)
    this.getInboundBandwidthCounter = this.getInboundBandwidthCounter.bind(this)

    this.serialPort = new SerialPort(comPath, {
      ...rest,
      autoOpen: false,
      lock: false,
    })

    // Immediately set low level serialport stuff
    this.onAttachmentPortSettings = onAttachmentPortSettings ?? onAttachmentPortSettingsDefault

    // Used by hint-validator-binary-handshake
    this.comPath = comPath

    this.serialPort.on('error', this.error)
    this.serialPort.on('data', this.receiveData)
    this.serialPort.on('close', this.close)
  }

  error(err: Error) {
    dTransport('SerialPort reporting error with error', err, 'on', this.comPath)
    this.onError(err)
  }

  close(err: Error) {
    if (err) {
      dTransport('SerialPort reporting close with error', err, 'on', this.comPath)
    } else {
      dTransport('SerialPort reporting close without error on ', this.comPath)
    }
    this.onClose(err)
  }

  receiveData(chunk: Buffer) {
    dTransport(
      'received raw serial data',
      chunk,
      this.serialPort.isOpen ? 'isOpen' : '!isOpen',
      this.serialPort.isPaused() ? 'isPaused' : '!isPaused',
    )

    this.inboundByteCounter += chunk.byteLength

    // This is a bit meaningless since nothing should fail now.
    const cancellationToken = new CancellationToken()

    this.readPipeline.push(chunk, cancellationToken).catch(err => {
      dTransport('Could not parse part of chunk', err, 'inside', chunk)
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

  connect(cancellationToken: CancellationToken) {
    mark(`serial:connect`)
    dTransport('Connecting to', this.comPath)
    return new Promise<void>((resolve, reject) => {
      this.serialPort.open((err: Error) => {
        measure(`serial:connect`)
        dTransport('Connected to', this.comPath)
        if (err) {
          reject(err)
          return
        }

        // Set our port settings immediately
        this.serialPort.set(this.onAttachmentPortSettings)

        dTransport('Set our settings', this.onAttachmentPortSettings, 'on', this.comPath)
        if (this.attachmentDelay === 0) {
          // syncronously resolve
          dTransport('Resolving connection on', this.comPath)
          resolve()
        } else {
          mark(`serial:connect-attachment-delay`)

          // Wait a certain period of time before reporting the connection being open
          setTimeout(() => {
            measure(`serial:connect-attachment-delay`)
            dTransport('Resolving connection on', this.comPath)
            resolve()
          }, this.attachmentDelay)
        }

        this.resetBandwidthCounters()
      })
    })
  }

  disconnect() {
    mark(`serial:disconnect`)
    dTransport('Disconnecting from', this.comPath)
    if (this.serialPort.isOpen) {
      return new Promise<void>((resolve, reject) => {
        this.serialPort.close((err: Error) => {
          measure(`serial:disconnect`)
          if (err) {
            dTransport("Couldn't disconnect from ", this.comPath, 'due to', err)
            reject(err)
            return
          }

          this.resetBandwidthCounters()

          dTransport('Disconnected from', this.comPath)
          resolve()
        })
      })
    }
    dTransport('Was already disconnected from', this.comPath)
    return Promise.resolve()
  }

  writeToDevice(chunk: Buffer, cancellationToken: CancellationToken) {
    dTransport(
      'writing raw serial data',
      chunk,
      this.serialPort.isOpen ? 'isOpen' : '!isOpen',
      this.serialPort.isPaused() ? 'isPaused' : '!isPaused',
    )

    return new Promise<void>((resolve, reject) => {
      if (!this.serialPort.isOpen) {
        const err = new Error('Cannot write, serialport is closed')

        // Increase the stack trace limit
        Error.stackTraceLimit = 100

        reject(err)
        return
      }

      // Cancel this promise if the token is cancelled
      cancellationToken.subscribe(reject)

      // check if we can continue
      const canContinue = this.serialPort.write(chunk, (err: Error) => {
        if (err) {
          reject(err)
          return
        }
      })

      // if we can't continue, pause the transport until the drain event
      if (!canContinue) {
        this.pause()
        this.serialPort.once('drain', () => {
          this.resume()
        })
      }

      // don't return this promise until the OS has drained it's buffer
      this.serialPort.drain((err: Error) => {
        if (err) {
          reject(err)
          return
        }

        this.outboundByteCounter += chunk.byteLength

        resolve()
      })
    })
  }
}
