import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { ObservationModel } from '../../../lib/models/resources/observation-model';

@Component({
  selector: 'app-lab-chart-detail',
  template: `
    <div [style.background]="isDarkMode ? '#1a2035' : '#f8f9fa'"
         style="padding: 20px 24px; height: 100%; box-sizing: border-box; overflow-y: auto;">

      <!-- History chart -->
      <h6 class="tx-semibold" [style.color]="isDarkMode ? '#c8d3e8' : '#596882'" style="margin-bottom:12px">{{ name }} — History</h6>
      <observation-visualization [observations]="observations"></observation-visualization>

      <!-- What is this lab? accordion -->
      <div class="mt-3">
        <button
          class="btn btn-sm btn-outline-secondary"
          type="button"
          (click)="toggleGlossary()">
          {{ glossaryOpen ? '▾' : '▸' }} What is this lab?
        </button>
        <div *ngIf="glossaryOpen"
             [style.background]="isDarkMode ? '#111827' : '#ffffff'"
             [style.borderColor]="isDarkMode ? '#2d3748' : '#dee2e6'"
             [style.color]="isDarkMode ? '#c8d3e8' : 'inherit'"
             class="mt-2 p-3 rounded border">
          <app-glossary-lookup
            [code]="loincCode"
            [codeSystem]="'http://loinc.org'">
          </app-glossary-lookup>
        </div>
      </div>

    </div>
  `,
})
export class LabChartDetailComponent implements ICellRendererAngularComp {
  observations: ObservationModel[] = [];
  name: string = '';
  loincCode: string = '';
  glossaryOpen: boolean = false;

  get isDarkMode(): boolean {
    return document.body.classList.contains('dark-theme')
  }

  private onGlossaryToggle: (code: string, open: boolean) => void;

  agInit(params: ICellRendererParams): void {
    this.observations = params.data?.models ?? [];
    this.name = params.data?.name ?? '';
    this.loincCode = params.data?.code ?? '';
    this.onGlossaryToggle = params.data?.onGlossaryToggle;
  }

  toggleGlossary(): void {
    this.glossaryOpen = !this.glossaryOpen;
    this.onGlossaryToggle?.(this.loincCode, this.glossaryOpen);
  }

  refresh(): boolean {
    return false;
  }
}
