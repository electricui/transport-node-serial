import { DiscoveryHintTransformer, Hint } from '@electricui/core'

import { SerialPortHintProducer } from './hint-producer'

const dHintTransformer = require('debug')(
  'electricui-transport-node-serial:usb-hint-transformer',
)

/**
 * The baudrate is optional, as they may use a transformer to add several baudRate options if they wish
 */
interface SerialPortHintTransformerOptions {
  usbTransportKey?: string
  producer: SerialPortHintProducer
  availabilityTimeout?: number
  /**
   * Poll every x milliseconds after receiving a hint from the usb attachment producer.
   */
  pollInterval?: number
}

interface USBAvailabilityHintIdentification {
  vendorId?: string
  productId?: string
}

export class SerialPortUSBHintTransformer extends DiscoveryHintTransformer {
  transportKey: string
  producer: SerialPortHintProducer
  options: SerialPortHintTransformerOptions
  timeout: number
  pollInterval: number

  constructor(options: SerialPortHintTransformerOptions) {
    super()

    this.transportKey = options.usbTransportKey || 'usb'
    this.options = options
    this.producer = options.producer
    this.timeout = options.availabilityTimeout ?? 5_000 // Poll for 5 seconds by default
    this.pollInterval = options.pollInterval ?? 50 // Poll every 50ms

    this.processAvailabilityHint = this.processAvailabilityHint.bind(this)
    this.processUnavailabilityHint = this.processUnavailabilityHint.bind(this)
  }

  canTransform(hint: Hint): boolean {
    return hint.getTransportKey() === this.transportKey
  }

  async processAvailabilityHint(hint: Hint<USBAvailabilityHintIdentification>) {
    // Continue polling until there's a hint that matches the vid and pid
    const { vendorId, productId } = hint.getIdentification()

    const continuationSignal = { signal: true }
    const timer = setTimeout(() => {
      continuationSignal.signal = false
    }, this.timeout)

    const startTime = new Date().getTime()

    // Labelled while loop, since we break out of it within the for loop below
    poll: while (continuationSignal.signal) {
      const polledHints = await this.producer.poll()

      for (const polledHint of polledHints) {
        const polledHintIdentification = polledHint.getIdentification()

        if (
          polledHintIdentification.vendorId === vendorId &&
          polledHintIdentification.productId === productId
        ) {
          // we found it, don't need to continue polling
          clearTimeout(timer)

          dHintTransformer(
            'Found serial port with vendorId',
            vendorId,
            'and productId',
            productId,
            'after',
            new Date().getTime() - startTime,
            'ms at ',
            polledHintIdentification.comPath,
          )
          // Break out of the _while_ loop, not the for loop
          break poll
        }
      }

      // Otherwise continue polling, wait a little while before trying again
      await new Promise((resolve, reject) =>
        setTimeout(resolve, this.pollInterval),
      )
    }
  }

  async processUnavailabilityHint(
    hint: Hint<USBAvailabilityHintIdentification>,
  ) {
    // The producer keeps track of poll attempts and raises unavailability hints if they're no longer available
    // Trigger this lookup now that we're pretty sure that a device has just disconnected
    this.producer.poll()
  }

  async transform(hint: Hint<USBAvailabilityHintIdentification>) {
    // the transport key is from the usb

    if (hint.isAvailabilityHint()) {
      await this.processAvailabilityHint(hint)
    } else {
      await this.processUnavailabilityHint(hint)
    }
  }
}
