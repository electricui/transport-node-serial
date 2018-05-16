import {
  TYPE_CALLBACK,
  TYPE_QUERY,
  MESSAGEID_SEARCH,
  POLLING_DISCOVERY,
  EVENT_DEVICE_AVAILABILITY_HINT,
  EVENT_DEVICE_UNAVAILABILITY_HINT,
  EVENT_DEVICE_DISCONNECTED
} from '@electricui/protocol-constants'

import { PassThrough } from 'stream'

const debug = require('debug')('electricui-transport-node-serial:discovery')
const debugHints = require('debug')('electricui-transport-node-serial:hints')

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
    this.type = POLLING_DISCOVERY
    this.transportKey = 'serial'
    this.canAcceptConnectionHints = true
    this.canAcceptDisconnectionHints = true

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
    hint
  ) => {
    debugHints(`Validating the unavailability hint ${hint}`)

    for (const obj of Object.values(this.cache)) {
      const connectionOptions = { comPath: obj.comPath }

      const transportHash = generateTransportHash(
        this.transportKey,
        connectionOptions
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
            graceful: false
          }
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
              productID: obj.productID
            }
          }
        })
      }
    }
  }

  validateAvailabilityHint = async (
    callback,
    generateTransportHash,
    isConnected,
    setConnected,
    hint
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
        }`
      )

      if (!hint.vendorID || !hint.productID) {
        return
      }

      // this is a promise chain that we're awaiting, it's a bit messy
      await this.SerialPort.list()
        .then(ports => {
          const devices = ports.filter(
            port =>
              hint.productID === parseInt(port.productId, 16) &&
              hint.vendorID === parseInt(port.vendorId, 16)
          )

          for (const device of devices) {
            hint.comPath = device.comName

            debugHints(`Going to attempt ${hint.comPath}`)

            this.validateAvailabilityHint(
              callback,
              generateTransportHash,
              isConnected,
              setConnected,
              hint
            )
          }
        })
        .catch(err => {
          debug(err.message)
          return null
        })

      // bail since we would have recursively called this function
      // with the comPath above
      return
    }

    debugHints(`Connection options built, checking connection status`)

    const transportHash = generateTransportHash(
      this.transportKey,
      connectionOptions
    )

    // make sure we're not already connected
    const connectedAlready = isConnected(transportHash)

    if (connectedAlready) {
      return // bail, we're already connected to this path
    }

    debugHints(`Building factory`)

    try {
      // we then generate a transport instance based on the merged configuration and dynamic options (eg the comPath / URI / filePath)
      const { transport, readInterface, writeInterface } = this.factory(
        Object.assign({}, this.configuration, connectionOptions)
      )

      // use the interfaces above to connect and do the needful
      setConnected(this.transportKey, connectionOptions, true)

      debugHints(`Connecting...`)
      await transport.connect()
      debugHints(`\tConnected.`)

      // waitForReply implementation

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

      readInterface.on('data', incomingData)

      debugHints(`Sending a search packet`)

      writeInterface.write({
        messageID: MESSAGEID_SEARCH,
        type: TYPE_CALLBACK,
        internal: true
      })

      // we should recieve: lv, bi, si in that order

      await createWaitForReply('si')

      debugHints(`Received search sequence response`)

      const { bi, ...restCacheInternal } = cacheInternal

      readInterface.removeListener('data', incomingData)
      transport.disconnect()
      setConnected(this.transportKey, connectionOptions, false)

      // get some device information
      const deviceInformation = {
        deviceID: bi, // this is always expected
        internal: {
          ...restCacheInternal
        },
        developer: {
          // this can be injected if the developer wants
          ...cacheDeveloper
        },
        transportKey: this.transportKey,
        connectionOptions: connectionOptions
      }

      debugHints(`Pushing callback`)

      // throw it in our cache so we can do disconnections
      this.cache[hint.comPath] = {
        deviceID: bi,
        connectionOptions: connectionOptions,
        comPath: hint.comPath,
        productID: hint.productID,
        vendorID: hint.vendorID
      }

      // bubble this method up as a potential connection method
      callback({
        transportKey: this.transportKey,
        connectionOptions,
        deviceInformation
      })
    } catch (e) {
      debugHints(`Couldn't connect, ${e}`)
    }
  }

  pollDiscovery() {
    // list every device, get comPaths for the potential candidates

    const constructHints = details => {
      // the dynamic connection options go here

      if (this.configuration.filter !== undefined) {
        // run the user provided filter function, if it returns false, bail early
        if (!this.configuration.filter(details)) {
          return
        }
      }

      debugHints(
        `Sending hint regarding a device we found at comPath ${details.comName}`
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
            productID: parseInt(details.productId, 16)
          }
        }
      })
    }

    this.SerialPort.list((err, ports) => {
      if (err) {
        debug(`Error detected ${err}`)
        console.error(err)
        return
      }

      ports.forEach(constructHints)
    })
  }
}

export default SerialDiscovery
