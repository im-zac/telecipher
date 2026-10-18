// Runtime = Node（照 teledeck）。Bun 只當 package manager。
export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },
  nitro: { preset: 'node-server' },
  runtimeConfig: {
    telecipherToken: '',                      // NUXT_TELECIPHER_TOKEN
    telecipherHome: process.env.HOME || '',   // NUXT_TELECIPHER_HOME，pathjail root
    telecipherDataDir: '',                    // NUXT_TELECIPHER_DATA_DIR，.requests.json/.vapid.json/.push-subscriptions.json 所在；空 = process.cwd()
    telecipherPushSubject: '',                // NUXT_TELECIPHER_PUSH_SUBJECT，VAPID subject；空 = https://github.com/im-zac/telecipher（Apple 拒絕 mailto:…@localhost）
  },
  app: {
    head: {
      title: 'telecipher',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#201c1a' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
})
