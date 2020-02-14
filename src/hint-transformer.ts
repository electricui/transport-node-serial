import { DiscoveryHintTransformer, Hint } from '@electricui/core'

import { SerialPortHintProducer } from './hint-producer'

const dHintTransformer = require('debug')(
  'electricui-transport-node-serial:hint-producer',
)

/**
 * The baudrate is optional, as they may use a transformer to add several baudRate options if they wish
 */
interface SerialPortHintTransformerOptions {
  usbTransportKey?: string
  producer: SerialPortHintProducer
}

export class SerialPortHintTransformer extends DiscoveryHintTransformer {
  transportKey: string
  producer: SerialPortHintProducer
  options: SerialPortHintTransformerOptions

  constructor(options: SerialPortHintTransformerOptions) {
    super()

    this.transportKey = options.usbTransportKey || 'usb'
    this.options = options
    this.producer = options.producer
  }

  canTransform(hint: Hint): boolean {
    return hint.getTransportKey() === this.transportKey
  }

  transform(hint: Hint) {
    // the transport key is from the usb

    this.producer.poll()

    if (hint.isAvailabilityHint()) {
      // availability hint

      return
    }

    // unavailability hint, we want to find
  }
}
