import fs from 'node:fs'
import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json'
import renderer from "vite-plugin-electron-renderer";

export default defineConfig(({command, mode}) => {
    const env = loadEnv(mode, process.cwd(), '')
    fs.rmSync('dist-electron', {recursive: true, force: true})

    const isServe = command === 'serve'
    const isBuild = command === 'build'

    return {
        plugins: [
            vue(),
            renderer({
                resolve: {
                    // C/C++ modules must be pre-bundle
                    serialport: {type: 'cjs'},
                },
            }),
            electron({
                main: {
                    entry: 'electron/main/index.ts',
                    onstart({startup}) {
                        startup()
                    },
                    vite: {
                        build: {
                            sourcemap: isServe,
                            minify: isBuild,
                            outDir: 'dist-electron/main',
                            rollupOptions: {
                                external: Object.keys(pkg.dependencies ?? {}),
                            },
                        },
                    },
                },

                preload: {
                    input: 'electron/preload/index.ts',
                    vite: {
                        build: {
                            sourcemap: isServe ? 'inline' : false,
                            minify: isBuild,
                            outDir: 'dist-electron/preload',
                            rollupOptions: {
                                external: Object.keys(pkg.dependencies ?? {}),
                            },
                        },
                    },
                }
            }),
        ],
        /** 👇 关键：从 env 读取端口 */
        server: {
            host: env.VITE_DEV_HOST || '0.0.0.0',
            port: Number(env.VITE_DEV_PORT) || 80,
        },
        clearScreen: false,
    }
})
