import { DiscoveryHintProducer, Hint } from '@electricui/core'

const dHintProducer = require('debug')(
  'electricui-transport-node-serial:hint-producer',
)

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
  previousHints: Map<string, Hint> = new Map()

  constructor(options: SerialPortHintProducerOptions) {
    super()

    this.transportKey = options.transportKey || 'serial'
    this.options = options

    this.serialPort = options.SerialPort
  }

  async poll() {
    this.setPolling(true)

    dHintProducer(`Polling`)
    console.time('polling_serial_devices')

    // TODO: figure out how to do this dependency injection
    const ports = await this.serialPort.list()

    dHintProducer(`Finished polling`)
    console.timeEnd('polling_serial_devices')

    if (!this.polling) {
      // if we were cancelled just don't send them up.
      return
    }

    // the current list of hints
    const currentHints: Map<string, Hint> = new Map()

    for (const port of ports) {
      // Create a hint for every port we found
      const hint = new Hint(this.transportKey)

      hint.setAvailabilityHint()

      hint.setIdentification({
        comPath: port.comName,
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

    const currentPollHashes = Array.from(currentHints.keys())

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

    // Set our previous list to our current list
    this.previousHints = currentHints

    // We're no longer polling
    this.setPolling(false)
  }
}
