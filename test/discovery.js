import sinon from 'sinon'
import chai from 'chai'
import chaiSubset from 'chai-subset'
import chaiAsPromised from 'chai-as-promised'
chai.use(chaiSubset)
chai.use(chaiAsPromised)

import SerialPort from 'serialport'

const assert = chai.assert

import SerialTransport from '../src/transport'
import SerialDiscovery from '../src/discovery'

import {
  BinaryProtocolDecoder,
  BinaryProtocolEncoder
} from '@electricui/protocol-binary'

import {
  TypeTransform,
  defaultDecoderList,
  defaultEncoderList
} from '@electricui/protocol-type-transforms'

// setup for the test

const typeCache = {}

const serialFactory = options => {
  // setup the serial transport, binary encoder and decoder

  const serialTransport = new SerialTransport(options)
  const serialDecoder = new BinaryProtocolDecoder({ typeCache })
  const serialEncoder = new BinaryProtocolEncoder()

  // pipe the typeCache from the decoder above into the type encoder below
  const serialTypeDecoder = new TypeTransform()
  const serialTypeEncoder = new TypeTransform({ typeCache })

  // setup the type transforms to use the default type ID <-> binary formats
  serialTypeDecoder.use(defaultDecoderList)
  serialTypeEncoder.use(defaultEncoderList)

  // the interfaces we use to read and write to serial
  const serialReadInterface = serialTransport.interface
    .pipe(serialDecoder)
    .pipe(serialTypeDecoder)

  //
  const serialWriteInterface = serialTypeEncoder
  serialTypeEncoder.pipe(serialEncoder).pipe(serialTransport.interface)
  /*
  serialEncoder.on('data', d => {
    console.log('writing', d)
  })

  serialTransport.interface.on('data', d => {
    console.log('direct read', d)
  })
*/
  return {
    // the transport handles connecting and disconnecting to individual devices
    transport: serialTransport,

    // these read and write interfaces allow for communication with the device
    readInterface: serialReadInterface,
    writeInterface: serialWriteInterface
  }
}

const serialConfiguration = {
  baudRate: 115200,
  manufacturer: 'blah',
  pnpId: 'afsdfasdf',
  SerialPort
}

// the tests

describe('SerialNodeDiscovery', () => {
  it('throws when provided with no options', () => {
    assert.throws(() => {
      new SerialTransport()
    })
  })

  it('throws when provided with empty options', () => {
    assert.throws(() => {
      new SerialTransport({})
    })
  })

  it('finds a hello board', done => {
    const transport = new SerialDiscovery({
      factory: serialFactory,
      configuration: serialConfiguration,
      SerialPort
    })

    const spy = sinon.spy()

    let doneness = false

    const callback = object => {
      spy(object)

      // this is a bit dumb
      assert.isTrue(spy.called)

      // just because we might get more than one callback
      if (!doneness) {
        done()
        doneness = true
      }
    }

    const isConnected = (transportKey, connectionOptions) => {
      return false
    }

    const setConnected = (transportKey, connectionOptions) => {}

    transport.discover(callback, isConnected, setConnected)
  }).timeout(5000)

  it('it connects to a hello board (no handshake, transport level)', done => {
    const transport = new SerialDiscovery({
      factory: serialFactory,
      configuration: serialConfiguration,
      SerialPort
    })

    const spy = sinon.spy()

    let doneness = false

    const callback = object => {
      spy(object)

      // this is a bit dumb
      assert.isTrue(spy.called)

      // merge in configuration for baudRate etc + connectionOptions
      const transport = new SerialTransport(
        Object.assign({}, serialConfiguration, object.connectionOptions)
      )

      // connect
      transport.connect().then(() => {
        // okay neat, disconnect
        transport.disconnect()

        done()
      })
    }

    const isConnected = (transportKey, connectionOptions) => {
      return false
    }

    const setConnected = (transportKey, connectionOptions) => {}

    transport.discover(callback, isConnected, setConnected)
  }).timeout(5000)
})
