import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {resolvePortablePath} from '../electron/main/utils/portable-path.ts'

const options = {
    configDirectory: path.resolve('/application/resources/config'),
    userDataDirectory: path.resolve('/users/example/application-data/autumn'),
}

describe('resolvePortablePath', () => {
    it('resolves paths relative to the configuration file', () => {
        assert.equal(
            resolvePortablePath('../sensevoice/model.onnx', options),
            path.resolve('/application/resources/sensevoice/model.onnx')
        )
    })

    it('resolves userData URLs with an authority segment', () => {
        assert.equal(
            resolvePortablePath('userData://models/sensevoice/model.onnx', options),
            path.resolve('/users/example/application-data/autumn/models/sensevoice/model.onnx')
        )
    })

    it('resolves standard userData URLs', () => {
        assert.equal(
            resolvePortablePath('userdata:///models/sensevoice/tokens.txt', options),
            path.resolve('/users/example/application-data/autumn/models/sensevoice/tokens.txt')
        )
    })

    it('rejects unsupported URL protocols', () => {
        assert.throws(
            () => resolvePortablePath('file:///tmp/model.onnx', options),
            /不支持的路径协议/
        )
    })
})
