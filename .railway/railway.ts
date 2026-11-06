// Applied with `railway config apply`. Railway reads the Dockerfile by itself. Secrets stay in Railway, not here.
import { defineRailway, project, service, volume } from 'railway/iac'

export default defineRailway(() => {
  // Everything the archive holds lives here. Removing this volume deletes the archive.
  const data = volume('folkbranch-data')
  const folkbranch = service('folkbranch', {
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    // SQLite and uploaded photos live on one volume, so one copy is the only correct number.
    replicas: 1,
    volumeMounts: { '/data': data },
  })
  return project('folkbranch', { resources: [folkbranch, data] })
})
