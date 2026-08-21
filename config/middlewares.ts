type Env = {
  (key: string, defaultValue?: string): string
  int(key: string, defaultValue?: number): number
  bool(key: string, defaultValue?: boolean): boolean
  array(key: string, defaultValue?: string[]): string[]
}

export default ({ env }: { env: Env }) => {
  const clientUrl = env('CLIENT_URL', 'http://localhost:3000')

  return [
    'strapi::logger',
    'strapi::errors',
    'strapi::security',
    {
      name: 'strapi::cors',
      config: {
        origin: [clientUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
        headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      },
    },
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ]
}
