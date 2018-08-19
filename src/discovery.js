import {
  EVENT_DEVICE_AVAILABILITY_HINT,
  EVENT_DEVICE_DISCONNECTED,
  EVENT_DEVICE_UNAVAILABILITY_HINT,
  MESSAGEID_SEARCH,
  TYPE_CALLBACK,
  TYPE_QUERY,
} from '@electricui/protocol-constants'

import { PassThrough } from 'stream'
import promiseFinally from 'promise.prototype.finally'

const debug = require('debug')('electricui-transport-node-serial:discovery')
const debugHints = require('debug')('electricui-transport-node-serial:hints')

// override Promise with the ability to have 'finally'
promiseFinally.shim() // will be a no-op if not needed

const SEARCH_TIMEOUT = 5000

function timeout(ms) {
  return new Promise(function(resolve, reject) {
    // Set up the timeout
    setTimeout(function() {
      reject('Promise timed out after ' + ms + ' ms')
    }, ms)
  })
}

class SerialDiscovery {
  constructor(opts) {
    const { factory, configuration = {} } = opts

    if (factory === undefined || factory === null) {
      throw new TypeError('no factory provided')
    }

    if (
      configuration.SerialPort === undefined ||
      configuration.SerialPort === null
    ) {
      throw new TypeError('You must provide a SerialPort instance')
    }

    this.factory = factory
    this.SerialPort = configuration.SerialPort

    this.transportKey = 'serial'
    this.canAcceptConnectionHints = true
    this.canAcceptDisconnectionHints = true
    this.canPoll = true

    this.eventInterface = new PassThrough({ objectMode: true })

    /*
      The configuration object is:
      {
        baudRate: 115200
      }
    */
    this.configuration = configuration

    this.cache = {}
  }

  validateUnavailabilityHint = async (
    generateTransportHash,
    isConnected,
    setConnected,
    hint,
  ) => {
    debugHints(`Validating the unavailability hint ${hint}`)

    for (const obj of Object.values(this.cache)) {
      const connectionOptions = { comPath: obj.comPath }

      const transportHash = generateTransportHash(
        this.transportKey,
        connectionOptions,
      )

      if (
        obj.productID === hint.productID &&
        obj.vendorID === hint.vendorID &&
        !isConnected(transportHash)
      ) {
        // disconnect, assume we can't connect
        this.eventInterface.write({
          type: EVENT_DEVICE_DISCONNECTED,
          deviceID: obj.deviceID,
          transportKey: this.transportKey,
          transportHash: transportHash,
          payload: {
            graceful: false,
          },
        })

        // explicitly validate that we can connect back to it (this should fail)
        this.eventInterface.write({
          type: EVENT_DEVICE_AVAILABILITY_HINT,
          payload: {
            transportKey: this.transportKey,
            detachment: false,
            hint: {
              comPath: obj.comPath,
              vendorID: obj.vendorID,
              productID: obj.productID,
            },
          },
        })
      }
    }
  }

  findPortFromHint = hint => {
    debugHints(
      `Trying to find a device with productID: ${hint.productID}, vendorID: ${
        hint.vendorID
      }`,
    )

    // list all serial ports
    return this.SerialPort.list()
      .then(ports => {
        // filter devices by ports with the same product and vendor IDs
        const devices = ports.filter(
          port =>
            hint.productID === parseInt(port.productId, 16) &&
            hint.vendorID === parseInt(port.vendorId, 16),
        )

        for (const details of devices) {
          debugHints(`Going to attempt ${hint.comName}`)
          // bubble it up to the event interface to send back down here.

          this.eventInterface.write({
            type: EVENT_DEVICE_AVAILABILITY_HINT,
            payload: {
              transportKey: this.transportKey,
              detachment: false,
              hint: {
                comPath: details.comName,
                vendorID: parseInt(details.vendorId, 16),
                productID: parseInt(details.productId, 16),
              },
            },
          })
        }
      })
      .catch(err => {
        debug(err.message)
        return null
      })
  }

  validateAvailabilityHint = async (
    callback,
    generateTransportHash,
    isConnected,
    setConnected,
    ephemeralConnectionHinter,
    hint,
  ) => {
    const connectionOptions = {}

    debugHints(`Validating the discovery from hint ${JSON.stringify(hint)}`)

    // easy, we know the comPath
    if (hint.comPath) {
      connectionOptions.comPath = hint.comPath
    } else {
      // we're going to have to find the right one based on the IDs
      debugHints(
        `Got a usb hint, vendorID: ${hint.vendorID} productID: ${
          hint.productID
        }`,
      )

      if (!hint.productID || !hint.vendorID) {
        console.error(
          'Received a node-serial hint without a productID or vendorID',
          hint,
        )
        return
      }

      await this.findPortFromHint(hint)

      // bail since we would have recursively called this function
      // with the comPath above
      return
    }

    debugHints(`Connection options built, checking connection status`)

    const transportHash = generateTransportHash(
      this.transportKey,
      connectionOptions,
    )

    // make sure we're not already connected
    const connectedAlready = isConnected(transportHash)

    if (connectedAlready) {
      return // bail, we're already connected to this path
    }

    debugHints(`Building factory`)

    const { transport, readInterface, writeInterface } = this.factory(
      Object.assign({}, this.configuration, connectionOptions),
    )

    debugHints(`Connecting...`)

    // setup subscriptions
    let cacheInternal = {}
    let cacheDeveloper = {}
    let subscriptions = {}

    const incomingData = packet => {
      if (packet.internal) {
        cacheInternal[packet.messageID] = packet.payload
      } else {
        cacheDeveloper[packet.messageID] = packet.payload
      }

      const cb = subscriptions[packet.messageID]

      if (cb) {
        cb(packet.payload)
      }
    }

    const createWaitForReply = messageID => {
      return new Promise((res, rej) => {
        subscriptions[messageID] = res
      })
    }

    // connect
    transport
      .connect()
      .then(() => {
        setConnected(this.transportKey, connectionOptions, true)
        debugHints(`\tConnected.`)
      })
      .then(() => {
        // attach subscriptions and wait for the search packet
        readInterface.on('data', incomingData)

        debugHints(`Sending a search packet`)

        writeInterface.write({
          messageID: MESSAGEID_SEARCH,
          type: TYPE_CALLBACK,
          internal: true,
        })

        // race promises of a timeout and awaiting for the SI message
        // TODO: catch this
        //return Promise.race([timeout(SEARCH_TIMEOUT), createWaitForReply('si')])

        return createWaitForReply('si')
      })
      .then(() => {
        return ephemeralConnectionHinter(readInterface, writeInterface)
      })
      .then(() => {
        // received the info we needed

        debugHints(`Received search sequence response`)

        const { bi, ...restCacheInternal } = cacheInternal

        // get some device information
        const deviceInformation = {
          deviceID: bi, // this is always expected
          internal: {
            ...restCacheInternal,
          },
          developer: {
            // this can be injected if the developer wants
            ...cacheDeveloper,
          },
          transportKey: this.transportKey,
          connectionOptions: connectionOptions,
        }

        debugHints(`Pushing callback`)

        // throw it in our cache so we can do disconnections
        this.cache[hint.comPath] = {
          deviceID: bi,
          connectionOptions: connectionOptions,
          comPath: hint.comPath,
          productID: hint.productID,
          vendorID: hint.vendorID,
        }

        // call our callback with the information we've received
        callback({
          transportKey: this.transportKey,
          connectionOptions,
          deviceInformation,
        })
      })
      .catch(e => {
        debugHints(`Couldn't discover ${JSON.stringify(hint)}, received error`)
        debugHints(e)
      })
      .finally(() => {
        // clean up
        readInterface.removeListener('data', incomingData)
        transport.disconnect()
        setConnected(this.transportKey, connectionOptions, false)
      })
  }

  constructPollHints = details => {
    // the dynamic connection options go here

    if (this.configuration.filter !== undefined) {
      // run the user provided filter function, if it returns false, bail early
      if (!this.configuration.filter(details)) {
        return
      }
    }

    debugHints(
      `Sending hint regarding a device we found at comPath ${details.comName}`,
    )

    // send an event up to the manager
    // (even though we can just deal with it here)
    this.eventInterface.write({
      type: EVENT_DEVICE_AVAILABILITY_HINT,
      payload: {
        transportKey: this.transportKey,
        detachment: false,
        hint: {
          comPath: details.comName,
          vendorID: parseInt(details.vendorId, 16),
          productID: parseInt(details.productId, 16),
        },
      },
    })
  }

  pollDiscovery() {
    // list every device, get comPaths for the potential candidates
    this.SerialPort.list((err, ports) => {
      if (err) {
        debug(`Error detected ${err}`)
        console.error(err)
        return
      }

      ports.forEach(this.constructPollHints)
    })
  }
}

export default SerialDiscovery
