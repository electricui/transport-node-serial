import { DiscoveryHintProducer, Hint } from '@electricui/core'
import { mark, measure } from './perf'

import { default as SerialPortNamespace } from 'serialport'

export const SERIAL_TRANSPORT_KEY = 'serial'

const dHintProducer = require('debug')(
  'electricui-transport-node-serial:hint-producer',
)

/**
 * The baudrate is optional, as they may use a transformer to add several baudRate options if they wish
 */
interface SerialPortHintProducerOptions {
  transportKey?: string
  SerialPort: typeof SerialPortNamespace
  baudRate?: number
}

export class SerialPortHintProducer extends DiscoveryHintProducer {
  transportKey: string
  serialPort: typeof SerialPortNamespace
  options: SerialPortHintProducerOptions
  previousHints: Map<string, Hint> = new Map()
  currentPoll: Promise<void> | null = null

  constructor(options: SerialPortHintProducerOptions) {
    super()

    this.transportKey = options.transportKey || SERIAL_TRANSPORT_KEY
    this.options = options

    this.serialPort = options.SerialPort

    this.internalPoll = this.internalPoll.bind(this)
  }

  private async internalPoll() {
    this.setPolling(true)

    dHintProducer(`Polling`)

    mark(`${this.transportKey}:list`)
    const ports = await this.serialPort.list()
    measure(`${this.transportKey}:list`)

    dHintProducer(`Finished polling`)

    if (!this.polling) {
      // if we were cancelled just don't send them up.
      return
    }

    // the current list of hints
    const currentHints: Map<string, Hint> = new Map()

    mark(`${this.transportKey}:send-hints`)

    for (const port of ports) {
      // Create a hint for every port we found
      const hint = new Hint(this.transportKey)

      hint.setAvailabilityHint()

      hint.setIdentification({
        comPath: port.path,
        vendorId: port.vendorId,
        productId: port.productId,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
      })

      hint.setConfiguration({
        baudRate: this.options.baudRate,
      })

      dHintProducer(`Found hint ${hint.getHash()}`)

      // Let the UI know we've found the port
      this.foundHint(hint)

      // Add the hint we found this time to our list
      currentHints.set(hint.getHash(), hint)
    }

    measure(`${this.transportKey}:send-hints`)

    const currentPollHashes = Array.from(currentHints.keys())

    mark(`${this.transportKey}:send-unavailability-hints`)

    // We have our list of hints we just found, check if any of our previous
    // ones aren't in this set
    for (const [hash, hint] of this.previousHints) {
      if (!currentPollHashes.includes(hash)) {
        // this hint has disappeared, create an unavailability hint.

        const unavailabilityHint = new Hint(hint.getTransportKey())
        unavailabilityHint.setUnavailabilityHint()
        unavailabilityHint.setIdentification(hint.getIdentification())
        unavailabilityHint.setConfiguration(hint.getConfiguration())

        dHintProducer(
          `Found a hint that isn't there anymore! ${hint.getHash()} `,
        )

        // Let the UI know we've found the unavailability hint
        this.foundHint(unavailabilityHint)
      }
    }

    measure(`${this.transportKey}:send-unavailability-hints`)

    // Set our previous list to our current list
    this.previousHints = currentHints

    // We're no longer polling
    this.setPolling(false)
  }

  /**
   * Return the same poll if there's currently one going.
   */
  poll() {
    if (this.polling && this.currentPoll) {
      return this.currentPoll
    }

    this.currentPoll = this.internalPoll()

    return this.currentPoll
  }
}
