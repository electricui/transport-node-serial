import { DiscoveryHintProducer, Hint } from '@electricui/core'
import { mark, measure } from './perf'
import { CancellationToken } from '@electricui/async-utilities'

import { SerialPort } from 'serialport'
import { PortInfo } from '@serialport/bindings-cpp'

export const SERIAL_TRANSPORT_KEY = 'serial'

const dHintProducer = require('debug')('electricui-transport-node-serial:hint-producer')

interface SerialPortHintProducerOptions {
  transportKey?: string
  SerialPort: typeof SerialPort
  baudRate: number
}

export interface SerialPortHintIdentification {
  path: string
  vendorId?: number
  productId?: number
  manufacturer?: string
  serialNumber?: string
}

export interface SerialPortHintConfiguration {
  baudRate: number
}

export function validateHintIsSerialHint(
  hint: Hint,
): hint is Hint<SerialPortHintIdentification, SerialPortHintConfiguration> {
  return hint.getTransportKey() === SERIAL_TRANSPORT_KEY
}

function processID(id?: string) {
  if (!id) {
    return 0x00
  }
  return Buffer.from(id, 'hex').readUInt16BE(0)
}

export class SerialPortHintProducer extends DiscoveryHintProducer {
  transportKey: string
  private SerialPort: typeof SerialPort
  private options: SerialPortHintProducerOptions
  private previousHints: Map<string, Hint<SerialPortHintIdentification, SerialPortHintConfiguration>> = new Map()
  private currentPoll: Promise<void> | null = null

  constructor(options: SerialPortHintProducerOptions) {
    super()

    this.transportKey = options.transportKey || SERIAL_TRANSPORT_KEY
    this.options = options

    this.SerialPort = options.SerialPort

    this.internalPoll = this.internalPoll.bind(this)
    this.portInfoToHint = this.portInfoToHint.bind(this)
  }

  private portInfoToHint(port: PortInfo) {
    const hint = new Hint<SerialPortHintIdentification, SerialPortHintConfiguration>(this.transportKey)

    hint.setAvailabilityHint()

    // Node serialport uses hex to represent the vendorId and productId, convert them to uint16s
    // so that we match both our rust version and the node-usb IDs.

    hint.setIdentification({
      path: port.path,
      vendorId: processID(port.vendorId),
      productId: processID(port.productId),
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
    })

    hint.setConfiguration({
      baudRate: this.options.baudRate,
    })

    return hint
  }

  public async internalPoll(cancellationToken: CancellationToken) {
    this.setPolling(true)

    dHintProducer(`Polling`)

    mark(`${this.transportKey}:list`)
    const ports = await this.SerialPort.list()
    measure(`${this.transportKey}:list`)

    dHintProducer(`Finished polling`)

    if (cancellationToken.isCancelled() || !this.polling) {
      // We were cancelled, don't bother sending it up
      return []
    }

    // the current list of hints
    const currentHints: Map<string, Hint<SerialPortHintIdentification, SerialPortHintConfiguration>> = new Map()

    mark(`${this.transportKey}:send-hints`)

    for (const port of ports) {
      // Create a hint for every port we found
      const hint = this.portInfoToHint(port)

      dHintProducer(`Found hint ${hint.getHash()}`)

      // Serial hints should return in about

      // Let the UI know we've found the port
      this.foundHint(hint, cancellationToken).catch(err => {
        if (!cancellationToken.caused(err)) {
          console.warn("Couldn't pass serial polled hint up", err)
        }
      })

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

        dHintProducer(`Found a hint that isn't there anymore! ${hint.getHash()} `)

        // Let the UI know we've found the unavailability hint
        this.foundHint(unavailabilityHint, cancellationToken).catch(err => {
          if (!cancellationToken.caused(err)) {
            console.warn("Couldn't pass serial detachment hint up")
          }
        })
      }
    }

    measure(`${this.transportKey}:send-unavailability-hints`)

    // Set our previous list to our current list
    this.previousHints = currentHints

    // We're no longer polling
    this.setPolling(false)

    return Array.from(currentHints.values())
  }

  /**
   * Return the same poll if there's currently one going.
   */
  poll(cancellationToken: CancellationToken) {
    if (this.polling && this.currentPoll) {
      return this.currentPoll
    }

    this.currentPoll = this.internalPoll(cancellationToken).then(res => void 0)

    return this.currentPoll
  }
}
