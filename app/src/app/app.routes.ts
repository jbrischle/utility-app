import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Dashboard - Meter Tracker',
  },
  {
    path: 'meters',
    loadComponent: () => import('./features/meters/meter-list/meter-list').then((m) => m.MeterList),
    title: 'Meters - Meter Tracker',
  },
  {
    path: 'meters/new',
    loadComponent: () => import('./features/meters/meter-form/meter-form').then((m) => m.MeterForm),
    title: 'New meter - Meter Tracker',
  },
  {
    path: 'meters/:id',
    loadComponent: () =>
      import('./features/meters/meter-detail/meter-detail').then((m) => m.MeterDetail),
    title: 'Meter - Meter Tracker',
  },
  {
    path: 'meters/:id/edit',
    loadComponent: () => import('./features/meters/meter-form/meter-form').then((m) => m.MeterForm),
    title: 'Edit meter - Meter Tracker',
  },
  {
    path: 'meters/:meterId/readings/new',
    loadComponent: () =>
      import('./features/readings/reading-form/reading-form').then((m) => m.ReadingForm),
    title: 'New reading - Meter Tracker',
  },
  {
    path: 'meters/:meterId/readings/:id/edit',
    loadComponent: () =>
      import('./features/readings/reading-form/reading-form').then((m) => m.ReadingForm),
    title: 'Edit reading - Meter Tracker',
  },
  { path: '**', redirectTo: '' },
];
