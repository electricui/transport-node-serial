import sinon from 'sinon'
import chai from 'chai'
import chaiSubset from 'chai-subset'
import chaiAsPromised from 'chai-as-promised'
chai.use(chaiSubset)
chai.use(chaiAsPromised)

const assert = chai.assert

import SerialTransport from '../src/transport'

describe('TransportElectronSerial', () => {
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

  it('throws when provided with no baudRate', () => {
    assert.throws(() => {
      new SerialTransport({ comPath: '/dev/null' })
    })
  })
  /*
  it('the transport read and write works', async () => {
    const transport = new SerialTransport({
      comPath: '/dev/null',
      baudRate: 115200,
      test: true,
      echo: true, // test only
      readyData: new Buffer(0)
    })

    const spy = sinon.spy()

    await transport.connect()

    transport.interface.on('data', data => {
      spy(data)

      transport.disconnect()

      assert.isTrue(spy.called)
      assert.deepEqual(spy.getCall(0).args[0], oneToFour)
    })

    const oneToFour = Buffer([0x01, 0x02, 0x03, 0x04])

    server.interface.write(oneToFour)
  })
*/
})
