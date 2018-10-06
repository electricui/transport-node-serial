import { DiscoveryHintProducer, Hint } from '@electricui/core'

/**
 * The baudrate is optional, as they may use a transformer to add several baudRate options if they wish
 */
interface SerialPortHintProducerOptions {
  transportKey?: string
  SerialPort: any
  baudRate?: number
}

export default class SerialPortHintProducer extends DiscoveryHintProducer {
  transportKey: string
  serialPort: any // SerialPort
  options: SerialPortHintProducerOptions
  constructor(options: SerialPortHintProducerOptions) {
    super()

    this.transportKey = options.transportKey || 'serial'
    this.options = options

    this.serialPort = options.SerialPort
  }

  async poll() {
    this.setPolling(true)

    // TODO: figure out how to do this dependency injection
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
