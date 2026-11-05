import type { Role } from '@/lib/types'

export const ROLES: Role[] = ['editor', 'reader', 'owner']

export const INVITE_ROLES: Role[] = ['editor', 'reader']

export const roleName: Record<Role, string> = { owner: 'владелец', editor: 'редактор', reader: 'читатель' }

export const roleHelp: Record<Role, string> = {
  owner: 'Вы владелец: можете менять всё, включая настройки и доступ других людей.',
  editor: 'Редактор: видит всех и может менять схему и биографии.',
  reader: 'Читатель: смотрит схему, живые родственники скрыты.',
}
