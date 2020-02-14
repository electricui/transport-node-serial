import { ConnectionMetadataReporter } from '@electricui/core'
import { SerialTransport } from './transport'

const dBandwidthReporter = require('debug')(
  'electricui-transport-node-serial:bandwidth-metadata',
)

export class SerialBandwidthMetadataReporter extends ConnectionMetadataReporter {
  metadataKeys = ['bpsIn', 'bpsOut']
  intervalDelay: number = 1000
  interval: NodeJS.Timer | null = null

  constructor() {
    super()
    this.tick = this.tick.bind(this)
  }

  async onConnect() {
    // setup what we have to, do at least one ping to figure out
    this.interval = setInterval(this.tick, this.intervalDelay)

    dBandwidthReporter('Starting bandwidth monitoring')
  }

  async onDisconnect() {
    // cleanup intervals
    if (this.interval) {
      clearInterval(this.interval)
    }

    // Report 0 bandwidth upon disconnect for sanity sake.
    const connection = this.connectionInterface!.connection!
    connection.reportConnectionMetadata('bpsIn', 0)
    connection.reportConnectionMetadata('bpsOut', 0)

    dBandwidthReporter('Stopping bandwidth monitoring')
  }

  tick() {
    const connection = this.connectionInterface!.connection!
    const transport = this.connectionInterface!.transport as SerialTransport

    // Grab the in and outbound buffers
    const bpsIn = transport.getInboundBandwidthCounter()
    const bpsOut = transport.getOutboundBandwidthCounter()

    // Reset the transport counter
    transport.resetBandwidthCounters()

    // Update the reporting
    connection.reportConnectionMetadata('bpsIn', bpsIn)
    connection.reportConnectionMetadata('bpsOut', bpsOut)
  }
}
