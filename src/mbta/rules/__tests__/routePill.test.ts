// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/RoutePillSpecTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Teal has two pill types (fixed, flex); Kotlin's FlexCompact maps to fixed content. Kotlin's
// Width.Circle is expressed as shape 'circle'. Height is a UI concern (RoutePill size prop).
import { createBuilder } from '@/mbta/testing/builders';

import { lineOf } from '../lineOrRoute';
import { routePillSpec } from '../routePill';

const TYPES = ['fixed', 'flex'] as const;

describe('RoutePillSpec', () => {
  it('bus', () => {
    const b = createBuilder();
    const bus = b.route({ type: 3, color: '#FFC72C', shortName: '62/76', textColor: '#000000' });
    for (const type of TYPES) {
      expect(routePillSpec(bus, { type })).toEqual({ text: '62/76', icon: null, shape: 'rectangle', width: type, color: '#FFC72C', textColor: '#000000' });
      expect(routePillSpec(bus, { type, context: 'searchStation' })).toEqual({
        text: null,
        icon: 'bus',
        shape: 'rectangle',
        width: type,
        color: '#FFC72C',
        textColor: '#000000',
      });
    }
  });

  it('heavy rail', () => {
    const b = createBuilder();
    const red = b.route({ type: 1, color: '#DA291C', longName: 'Red Line', textColor: '#FFFFFF' });
    const blue = b.route({ type: 1, color: '#003DA5', longName: 'Blue Line', textColor: '#FFFFFF' });
    for (const type of TYPES) {
      expect(routePillSpec(red, { type })).toEqual({ text: 'RL', icon: null, shape: 'capsule', width: type, color: '#DA291C', textColor: '#FFFFFF' });
      expect(routePillSpec(blue, { type })).toEqual({ text: 'BL', icon: null, shape: 'capsule', width: type, color: '#003DA5', textColor: '#FFFFFF' });
    }
  });

  it('light rail', () => {
    const b = createBuilder();
    const greenC = b.route({ id: 'Green-C', type: 0, color: '#00843D', longName: 'Green Line C', shortName: 'C', textColor: '#FFFFFF' });
    const mattapan = b.route({ id: 'Mattapan', type: 0, color: '#DA291C', longName: 'Mattapan Line', textColor: '#FFFFFF' });
    for (const type of TYPES) {
      expect(routePillSpec(greenC, { type })).toEqual({ text: 'C', icon: null, shape: 'circle', width: type, color: '#00843D', textColor: '#FFFFFF' });
      expect(routePillSpec(mattapan, { type })).toEqual({ text: 'M', icon: null, shape: 'capsule', width: type, color: '#DA291C', textColor: '#FFFFFF' });
    }
  });

  it('commuter rail', () => {
    const b = createBuilder();
    const middleborough = b.route({ type: 2, color: '#80276C', longName: 'Middleborough/Lakeville Line', textColor: '#FFFFFF' });
    const providence = b.route({ type: 2, color: '#80276C', longName: 'Providence/Stoughton Line', textColor: '#FFFFFF' });
    expect(routePillSpec(middleborough, { type: 'fixed' }).text).toBe('CR');
    expect(routePillSpec(middleborough, { type: 'flex' }).text).toBe('Middleborough/Lakeville');
    expect(routePillSpec(providence, { type: 'flex' })).toEqual({
      text: 'Providence/Stoughton',
      icon: null,
      shape: 'capsule',
      width: 'flex',
      color: '#80276C',
      textColor: '#FFFFFF',
    });
  });

  it('ferry', () => {
    const b = createBuilder();
    const ferry = b.route({ type: 4, color: '#008EAA', longName: 'Hingham/Hull Ferry', textColor: '#FFFFFF' });
    expect(routePillSpec(ferry, { type: 'fixed' })).toEqual({ text: null, icon: 'ferry', shape: 'capsule', width: 'fixed', color: '#008EAA', textColor: '#FFFFFF' });
    expect(routePillSpec(ferry, { type: 'flex' })).toEqual({
      text: 'Hingham/Hull Ferry',
      icon: null,
      shape: 'capsule',
      width: 'flex',
      color: '#008EAA',
      textColor: '#FFFFFF',
    });
  });

  it('lines', () => {
    const b = createBuilder();
    const redLine = b.line({ id: 'line-Red', color: '#DA291C', longName: 'Red Line', textColor: '#FFFFFF' });
    const greenLine = b.line({ id: 'line-Green', color: '#00843D', longName: 'Green Line', textColor: '#FFFFFF' });
    for (const type of TYPES) {
      expect(routePillSpec(lineOf(redLine, []), { type })).toEqual({ text: 'Red Line', icon: null, shape: 'capsule', width: type, color: '#DA291C', textColor: '#FFFFFF' });
      expect(routePillSpec(lineOf(greenLine, []), { type })).toEqual({ text: 'GL', icon: null, shape: 'capsule', width: type, color: '#00843D', textColor: '#FFFFFF' });
    }
  });

  it('shuttle buses use a bus icon unless flex', () => {
    const b = createBuilder();
    const shuttle = b.route({ id: 'Shuttle-Generic', type: 3, shortName: 'Red Line Shuttle' });
    expect(routePillSpec(shuttle, { type: 'fixed' })).toMatchObject({ icon: 'bus', shape: 'capsule' });
    expect(routePillSpec(shuttle, { type: 'flex' })).toMatchObject({ text: 'Red Line Shuttle', shape: 'capsule' });
  });
});
