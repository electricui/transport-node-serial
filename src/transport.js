import { EVENT_DEVICE_DISCONNECTED } from '@electricui/protocol-constants'
import { PassThrough } from 'stream'

class SerialTransport {
  constructor(options = {}) {
    if (options.comPath === undefined || options.comPath === null) {
      throw new TypeError('no comPath provided')
    }

    if (options.baudRate === undefined || options.baudRate === null) {
      throw new TypeError('no baudRate provided')
    }

    if (options.SerialPort === undefined || options.SerialPort === null) {
      throw new TypeError('You must provide a SerialPort instance')
    }

    if (
      options.eventInterface === undefined ||
      options.eventInterface === null
    ) {
      throw new TypeError('You must provide an eventInterface')
    }

    const { comPath, ...rest } = options

    // we want to setup the duplex stream
    // but we don't want to connect until we're asked to
    // we also don't want to lock the port,
    this.options = { ...rest, autoOpen: false, lock: false }

    this.comPath = comPath

    const SerialPort = options.SerialPort

    this.serialPort = new SerialPort(this.comPath, this.options)
    this.eventInterface = options.eventInterface

    this.readInterface = new PassThrough({ objectMode: false })
    this.writeInterface = new PassThrough({ objectMode: false })
  }

  connect = () => {
    return new Promise((resolve, reject) => {
      this.serialPort.open(err => {
        if (err) {
          reject(err)
        } // else {
        //  resolve()
        //}
      })

      this.serialPort.once('close', err => {
        // send a disconnection event if it disconnects
        this.eventInterface.write({
          type: EVENT_DEVICE_DISCONNECTED,
          payload: {
            graceful: !(err && err.disconnected),
          },
        })
      })

      // any advantage in the above way to do this?
      this.serialPort.once('open', () => {
        this.serialPort.pipe(this.readInterface)
        this.writeInterface.pipe(this.serialPort)
        resolve()
      })
    })
  }

  disconnect = () => {
    if (this.serialPort) this.serialPort.unpipe(this.readInterface)
    if (this.writeInterface) this.writeInterface.unpipe(this.serialPort)

    if (this.serialPort.isOpen) {
      return this.serialPort.close()
    }
    return Promise.resolve()
  }
}

export default SerialTransport
