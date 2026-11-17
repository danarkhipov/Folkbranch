import { facesInfo, facesStatus, removeFaces, saveFaces, scanFaces, testFaces } from '@/lib/faces/service'
import { human, type Route } from '../router'

export const faceRoutes: Route[] = [
  human('GET', 'faces/info', 'Whether faces can be found in the cloud, and where the photos go', () => facesInfo()),
  human('GET', 'faces', 'The cloud face setup, for the owner', ({ actor }) => facesStatus(actor)),
  human('PUT', 'faces', 'Connect a face service', async ({ actor, body }) => saveFaces(actor, await body())),
  human('DELETE', 'faces', 'Disconnect the face service', ({ actor }) => removeFaces(actor)),
  human('POST', 'faces/test', 'Try the face service with a blank picture', ({ actor }) => testFaces(actor)),
  human('POST', 'faces/scan', 'Find faces and recognise known people through the owner\'s face service', async ({ actor, body }) => scanFaces(actor, await body())),
]
