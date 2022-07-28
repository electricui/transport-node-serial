import { Sink, Transport } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'
import { SerialPort } from 'serialport'

import { mark, measure } from './perf'

import debug from 'debug'

const dTransport = debug('electricui-transport-node-serial:transport')

// Because of Typescript shenannigans, we're pulling the interfaces from @serialport/bindings-cpp in manually

export declare interface SetOptions {
  brk?: boolean
  cts?: boolean
  dsr?: boolean
  dtr?: boolean
  rts?: boolean
}

export interface OpenOptions {
  /** The system path of the serial port you want to open. For example, `/dev/tty.XXX` on Mac/Linux, or `COM1` on Windows */
  path: string
  /**
   * The baud rate of the port to be opened. This should match one of the commonly available baud rates, such as 110, 300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, or 115200. Custom rates are supported best effort per platform. The device connected to the serial port is not guaranteed to support the requested baud rate, even if the port itself supports that baud rate.
   */
  baudRate: number
  /** Must be one of these: 5, 6, 7, or 8 defaults to 8 */
  dataBits?: 5 | 6 | 7 | 8
  /** Prevent other processes from opening the port. Windows does not currently support `false`. Defaults to true */
  lock?: boolean
  /** Must be 1, 1.5 or 2 defaults to 1 */
  stopBits?: 1 | 1.5 | 2
  parity?: string
  /** Flow control Setting. Defaults to false */
  rtscts?: boolean
  /** Flow control Setting. Defaults to false */
  xon?: boolean
  /** Flow control Setting. Defaults to false */
  xoff?: boolean
  /** Flow control Setting defaults to false*/
  xany?: boolean
  /** drop DTR on close. Defaults to true */
  hupcl?: boolean
}

export interface SerialTransportOptions extends OpenOptions {
  // Darwin

  /** Defaults to none */
  //parity?: 'none' | 'even' | 'odd'
  /** see [`man termios`](http://linux.die.net/man/3/termios) defaults to 1 */
  vmin?: number
  /** see [`man termios`](http://linux.die.net/man/3/termios) defaults to 0 */
  vtime?: number

  // Windows

  /** Device parity defaults to none */
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
  /** RTS mode defaults to handshake */
  rtsMode?: 'handshake' | 'enable' | 'toggle'

  // Linux

  /** Defaults to none */
  // parity?: 'none' | 'even' | 'odd'
  /** see [`man termios`](http://linux.die.net/man/3/termios) defaults to 1 */
  // vmin?: number
  /** see [`man termios`](http://linux.die.net/man/3/termios) defaults to 0 */
  // vtime?: number

  path: string
  SerialPort: typeof SerialPort
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
  SerialPort: SerialPort
  inboundByteCounter: number = 0
  outboundByteCounter: number = 0
  /**
   * Used as an escape hatch in hint-validator-binary-handshake in order to assign devices
   * with the same boardID (because of a developer mistake) unique deviceIDs.
   */
  isSerialTransport = true as const
  attachmentDelay: number
  onAttachmentPortSettings: SetOptions
  public path = ''

  constructor(options: SerialTransportOptions) {
    super()

    const { SerialPort, path, attachmentDelay, onAttachmentPortSettings, ...rest } = options

    if (!SerialPort) {
      throw new Error('SerialPort must be passed to transport-node-serial.')
    }

    if (!path) {
      throw new Error('The SerialTransport needs a path passed to it.')
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

    this.SerialPort = new SerialPort({
      ...rest,
      path: path,
      autoOpen: false,
      lock: true,
    })

    // Immediately set low level serialport stuff
    this.onAttachmentPortSettings = onAttachmentPortSettings ?? onAttachmentPortSettingsDefault

    // Used by hint-validator-binary-handshake
    this.path = path

    this.SerialPort.on('error', this.error)
    this.SerialPort.on('data', this.receiveData)
    this.SerialPort.on('close', this.close)
  }

  error(err: Error) {
    dTransport('SerialPort reporting error with error', err, 'on', this.path)
    this.onError(err)
  }

  close(err: Error) {
    if (err) {
      dTransport('SerialPort reporting close with error', err, 'on', this.path)
      this.onError(err)
    } else {
      dTransport('SerialPort reporting close without error on ', this.path)
    }
    this.onClose(err)
  }

  receiveData(chunk: Buffer) {
    dTransport(
      'received raw serial data',
      chunk,
      this.SerialPort.isOpen ? 'isOpen' : '!isOpen',
      this.SerialPort.isPaused() ? 'isPaused' : '!isPaused',
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
    dTransport('Connecting to', this.path)
    return new Promise<void>((resolve, reject) => {
      this.SerialPort.open((err: Error) => {
        measure(`serial:connect`)
        dTransport('Connected to', this.path)
        if (err) {
          reject(err)
          return
        }

        // Set our port settings immediately
        this.SerialPort.set(this.onAttachmentPortSettings)

        dTransport('Set our settings', this.onAttachmentPortSettings, 'on', this.path)
        if (this.attachmentDelay === 0) {
          // synchronously resolve
          dTransport('Resolving connection on', this.path)
          resolve()
        } else {
          mark(`serial:connect-attachment-delay`)

          // Wait a certain period of time before reporting the connection being open
          setTimeout(() => {
            measure(`serial:connect-attachment-delay`)
            dTransport('Resolving connection on', this.path)
            resolve()
          }, this.attachmentDelay)
        }

        this.resetBandwidthCounters()
      })

      // Cancel this promise if the token is cancelled
      cancellationToken.subscribe(reject)
    })
  }

  disconnect() {
    mark(`serial:disconnect`)
    dTransport('Disconnecting from', this.path)
    if (this.SerialPort.isOpen) {
      return new Promise<void>((resolve, reject) => {
        this.SerialPort.close((err: Error) => {
          measure(`serial:disconnect`)
          if (err) {
            dTransport("Couldn't disconnect from ", this.path, 'due to', err)
            reject(err)
            return
          }

          this.resetBandwidthCounters()

          dTransport('Disconnected from', this.path)
          resolve()
        })
      })
    }
    dTransport('Was already disconnected from', this.path)
    return Promise.resolve()
  }

  writeToDevice(chunk: Buffer, cancellationToken: CancellationToken) {
    dTransport(
      'writing raw serial data',
      chunk,
      this.SerialPort.isOpen ? 'isOpen' : '!isOpen',
      this.SerialPort.isPaused() ? 'isPaused' : '!isPaused',
    )

    return new Promise<void>((resolve, reject) => {
      if (!this.SerialPort.isOpen) {
        const err = new Error('Cannot write, serialport is closed')

        // Increase the stack trace limit
        Error.stackTraceLimit = 100

        reject(err)
        return
      }

      // Cancel this promise if the token is cancelled
      cancellationToken.subscribe(reject)

      // check if we can continue
      const canContinue = this.SerialPort.write(chunk, (err: Error) => {
        if (err) {
          reject(err)
          return
        }
      })

      // if we can't continue, pause the transport until the drain event
      if (!canContinue) {
        this.pause()
        this.SerialPort.once('drain', () => {
          this.resume()
        })
      }

      // don't return this promise until the OS has drained it's buffer
      this.SerialPort.drain((err: Error) => {
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
