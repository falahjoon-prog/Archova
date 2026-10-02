import { DescriptionList } from '@archova/ui';
import type { Weather } from '../lib/types';

const or = (v: number | string | null, unit = '') => (v === null ? 'not recorded' : `${v}${unit}`);

/** BOM-style observations for the day, with the station named (DIA-AC2, X44). */
export function WeatherSummary({ weather }: { weather: Weather }) {
  const c = weather.conditions;
  const station =
    weather.stationName ?? (weather.stationId ? `station ${weather.stationId}` : null);
  return (
    <div className="stack">
      <DescriptionList
        items={[
          {
            label: 'Temperature',
            value:
              weather.minC === null && weather.maxC === null
                ? 'not recorded'
                : `${or(weather.minC, '°')} to ${or(weather.maxC, '°C')}`,
          },
          { label: 'Rainfall', value: or(weather.rainMm, ' mm') },
          { label: 'Wind', value: or(weather.windKmh, ' km/h') },
          {
            label: 'Conditions',
            value: `7am ${or(c.at7am)} · 12pm ${or(c.at12pm)} · 3pm ${or(c.at3pm)}`,
          },
        ]}
      />
      {station ? (
        <p className="u-caption u-m-0">
          Observations from {station}
          {weather.stationName && weather.stationId ? ` (station ${weather.stationId})` : ''}.
        </p>
      ) : null}
    </div>
  );
}
