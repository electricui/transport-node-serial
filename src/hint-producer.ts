import { DiscoveryHintProducer, Hint } from '@electricui/core'

import { SerialPort } from './serialport-types'

/**
 * The baudrate is optional, as they may use a transformer to add several baudRate options if they wish
 */
interface SerialPortHintProducerOptions {
  transportKey?: string
  SerialPort: SerialPort
  baudRate?: number
}

export default class SerialPortHintProducer extends DiscoveryHintProducer {
  transportKey: string
  serialPort: SerialPort
  options: SerialPortHintProducerOptions
  constructor(options: SerialPortHintProducerOptions) {
    super(options)

    this.transportKey = options.transportKey || 'serial'
    this.options = options

    this.serialPort = options.SerialPort
  }

  async poll() {
    this.setPolling(true)

    const ports = await this.serialPort.list()

    if (!this.polling) {
      // if we were cancelled just don't send them up.
      return
    }

    for (const port of ports) {
      const hint = new Hint(this.transportKey)

      hint.setAvailabilityHint()

      hint.setIdentification({
        comPath: port.comName,
        vendorId: port.vendorId,
        productId: port.productId,
      })
      hint.setConfiguration({
        baudRate: this.options.baudRate,
      })

      this.foundHint(hint)
    }

    this.setPolling(false)
  }
}
