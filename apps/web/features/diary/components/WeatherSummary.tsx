import { DescriptionList } from '@archova/ui';
import type { Weather } from '../lib/types';

/** BOM-style observations for the day, with the station named (DIA-AC2, X44). */
export function WeatherSummary({ weather }: { weather: Weather }) {
  return (
    <div className="stack">
      <DescriptionList
        items={[
          { label: 'Temperature', value: `${weather.minC}° to ${weather.maxC}°C` },
          { label: 'Rainfall', value: `${weather.rainMm} mm` },
          { label: 'Wind', value: `${weather.windKmh} km/h` },
          {
            label: 'Conditions',
            value: `7am ${weather.conditions.at7am} · 12pm ${weather.conditions.at12pm} · 3pm ${weather.conditions.at3pm}`,
          },
        ]}
      />
      <p className="u-caption u-m-0">
        Observations from {weather.stationName} (station {weather.stationId}).
      </p>
    </div>
  );
}
