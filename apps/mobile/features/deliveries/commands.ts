// Material deliveries on the phone: today's and the coming week's bookings, and logging a truck arriving or unloaded
// at the time it happened. Online only.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface DeliveryTarget {
  orgId: string;
  projectId: string;
}

const path = (t: DeliveryTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listDeliveries(
  api: ApiClient,
  t: DeliveryTarget,
  range: { from: string; to: string },
) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/deliveries', {
      params: { path: path(t), query: range },
    }),
  ).data;
}

export async function checkInDelivery(
  api: ApiClient,
  t: DeliveryTarget,
  deliveryId: string,
  event: 'arrived' | 'unloaded',
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/deliveries/{deliveryId}/check-in', {
      params: { path: { ...path(t), deliveryId } },
      body: { event },
    }),
  );
}
