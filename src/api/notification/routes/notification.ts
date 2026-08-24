import { factories } from '@strapi/strapi'

export default factories.createCoreRouter('api::notification.notification', {
  config: {
    find: { auth: { scope: [] } },
    findOne: { auth: { scope: [] } },
    create: { auth: { scope: [] } },
    update: { auth: { scope: [] } },
    delete: { auth: { scope: [] } },
  },
})
