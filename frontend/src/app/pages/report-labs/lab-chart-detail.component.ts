import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { GridApi, ICellRendererParams } from 'ag-grid-community';
import { ObservationModel } from '../../../lib/models/resources/observation-model';

@Component({
  selector: 'app-lab-chart-detail',
  template: `
    <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden;">

      <!-- Row header — always visible, same height as a normal row -->
      <div style="height: 42px; display: flex; align-items: center; padding: 0 12px; cursor: pointer; flex-shrink: 0;">
        <span>{{ isExpanded ? '▾' : '▸' }} {{ name }}</span>
      </div>

      <!-- Expanded content — only rendered when open; stops click propagation so
           interacting inside doesn't collapse the row -->
      <div *ngIf="isExpanded"
           (click)="$event.stopPropagation()"
           [style.background]="isDarkMode ? '#1a2035' : '#f8f9fa'"
           style="flex: 1; padding: 16px 24px; overflow-y: auto; border-top: 1px solid rgba(0,0,0,0.08);">

        <h6 class="tx-semibold" [style.color]="isDarkMode ? '#c8d3e8' : '#596882'" style="margin-bottom: 12px">
          {{ name }} — History
        </h6>

        <observation-visualization [observations]="observations"></observation-visualization>

        <div class="mt-3">
          <button class="btn btn-sm btn-outline-secondary" type="button" (click)="toggleGlossary()">
            {{ glossaryOpen ? '▾' : '▸' }} What is this lab?
          </button>
          <div *ngIf="glossaryOpen"
               [style.background]="isDarkMode ? '#111827' : '#ffffff'"
               [style.borderColor]="isDarkMode ? '#2d3748' : '#dee2e6'"
               [style.color]="isDarkMode ? '#c8d3e8' : 'inherit'"
               class="mt-2 p-3 rounded border">
            <app-glossary-lookup [code]="loincCode" [codeSystem]="'http://loinc.org'"></app-glossary-lookup>
          </div>
        </div>

      </div>
    </div>
  `,
})
export class LabChartDetailComponent implements ICellRendererAngularComp {
  name: string = '';
  isExpanded: boolean = false;
  observations: ObservationModel[] = [];
  loincCode: string = '';
  glossaryOpen: boolean = false;
  private params: ICellRendererParams;
  private api: GridApi;

  get isDarkMode(): boolean {
    return document.body.classList.contains('dark-theme');
  }

  agInit(params: ICellRendererParams): void {
    this.params = params;
    this.api = params.api;
    this.name = params.data?.name ?? '';
    this.isExpanded = params.data?.isExpanded ?? false;
    this.glossaryOpen = params.data?.glossaryOpen ?? false;
    this.observations = params.data?.models ?? [];
    this.loincCode = params.data?.code ?? '';
  }

  // Called by AG Grid when cell data changes (e.g. after refreshCells).
  // Return true so AG Grid reuses the component instead of destroying/re-creating it.
  refresh(params: ICellRendererParams): boolean {
    this.params = params;
    this.isExpanded = params.data?.isExpanded ?? false;
    this.glossaryOpen = params.data?.glossaryOpen ?? false;
    this.observations = params.data?.models ?? [];
    return true;
  }

  toggleGlossary(): void {
    this.glossaryOpen = !this.glossaryOpen;
    // Write back so getRowHeight can read it
    if (this.params.data) {
      this.params.data.glossaryOpen = this.glossaryOpen;
    }
    this.api?.resetRowHeights();
  }
}
