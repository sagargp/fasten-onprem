import { Component, OnInit } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FastenApiService } from '../../services/fasten-api.service';
import { ResourceFhir } from '../../models/fasten/resource_fhir';
import * as fhirpath from 'fhirpath';
import { forkJoin, Observable } from 'rxjs';
import { map, mergeMap, switchMap } from 'rxjs/operators';
import { Source } from '../../models/fasten/source';
import { ResponseWrapper } from '../../models/response-wrapper';
import { ActivatedRoute, Params } from '@angular/router';
import { FastenDisplayModel } from '../../../lib/models/fasten/fasten-display-model';
import { fhirModelFactory } from '../../../lib/models/factory';
import { ResourceType } from '../../../lib/models/constants';
import { ObservationModel } from '../../../lib/models/resources/observation-model';
import {
  ColDef, GridApi, GridReadyEvent, RowClickedEvent,
  GetRowIdParams, RowClassParams
} from 'ag-grid-community';
import { LabChartDetailComponent } from './lab-chart-detail.component';

class ObservationGroup { [key: string]: ResourceFhir[] }
class ObservationGroupInfo {
  observationGroups: ObservationGroup = {}
  observationGroupTitles: { [key: string]: string } = {}
}
class LabResultCodeByDate {
  label: string
  value: string
}

export interface LabRow {
  code: string
  name: string
  panel: string
  result: string
  date: Date | null
  models: ObservationModel[]
  source: string
  flag: 'H' | 'L' | ''
  isExpanded?: boolean
  glossaryOpen?: boolean
}

@Component({
  selector: 'app-report-labs',
  templateUrl: './report-labs.component.html',
  styleUrls: ['./report-labs.component.scss']
})
export class ReportLabsComponent implements OnInit {
  loading: boolean = false

  get isDarkMode(): boolean {
    return document.body.classList.contains('dark-theme')
  }

  // diagnostic report filter
  reportSourceId: string = ''
  reportResourceType: string = ''
  reportResourceId: string = ''
  reportDisplayModel: FastenDisplayModel = null
  diagnosticReports: ResourceFhir[] = []
  isEmptyReport = false

  // AG Grid
  rowData: LabRow[] = []
  private gridApi: GridApi

  paginationPageSize: number = 15
  pageSizeOptions: number[] = [15, 25, 50, 100, 250]
  // map from observation source_resource_id → panel name
  private panelMap: Map<string, string> = new Map()
  // map from source_id → human-readable source name
  private sourceMap: Map<string, string> = new Map()

  columnDefs: ColDef[] = [
    {
      headerName: 'Lab Name',
      field: 'name',
      filter: 'agTextColumnFilter',
      filterParams: { buttons: ['reset'], debounceMs: 200 },
      flex: 3,
      cellRenderer: LabChartDetailComponent,
      cellStyle: { padding: '0', overflow: 'hidden' },
      // When expanded, span all 6 columns so the chart fills the full row width
      colSpan: (params) => params.data?.isExpanded ? 6 : 1,
    },
    {
      headerName: 'Panel',
      field: 'panel',
      filter: 'agTextColumnFilter',
      filterParams: { buttons: ['reset'], debounceMs: 200 },
      flex: 2,
    },
    {
      headerName: 'Result',
      field: 'result',
      filter: false,
      flex: 2,
    },
    {
      headerName: 'Source',
      field: 'source',
      filter: 'agTextColumnFilter',
      filterParams: { buttons: ['reset'], debounceMs: 200 },
      flex: 2,
    },
    {
      headerName: 'Flag',
      field: 'flag',
      filter: false,
      sortable: true,
      flex: 1,
      cellRenderer: (params) => {
        const flag = params.value
        if (flag === 'H') return `<span style="color:#b91c1c;font-weight:600;font-size:12px">▲ H</span>`
        if (flag === 'L') return `<span style="color:#1d4ed8;font-weight:600;font-size:12px">▼ L</span>`
        return ''
      },
    },
    {
      headerName: 'Date',
      field: 'date',
      filter: 'agDateColumnFilter',
      filterParams: {
        buttons: ['reset'],
        comparator: (filterDate: Date, cellValue: Date) => {
          if (!cellValue) return -1
          const cell = new Date(cellValue)
          cell.setHours(0, 0, 0, 0)
          if (cell < filterDate) return -1
          if (cell > filterDate) return 1
          return 0
        }
      },
      valueFormatter: (p) => p.value
        ? new Date(p.value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '',
      flex: 2,
    },
  ]

  defaultColDef: ColDef = {
    sortable: false,
    resizable: true,
  }

  getRowId = (params: GetRowIdParams) => params.data.code
  getRowClass = (_params: RowClassParams) => 'ag-row-clickable'
  getRowHeight = (params) => {
    if (!params.data?.isExpanded) return 42
    if (params.data?.glossaryOpen) return 650
    const pointCount = (params.data?.models?.length ?? 1)
    return 100 + pointCount * 40 + 80
  }

  constructor(
    private fastenApi: FastenApiService,
    private activatedRoute: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    this.loading = true
    this.populateReports()

    // build panel + source maps first, then load observations
    this.activatedRoute.params.pipe(
      switchMap((routeParams: Params) => {
        this.reportSourceId = routeParams['source_id']
        this.reportResourceType = routeParams['resource_type']
        this.reportResourceId = routeParams['resource_id']
        return forkJoin([this.buildPanelMap(), this.buildSourceMap()])
      })
    ).subscribe(() => {
      if (this.reportSourceId && this.reportResourceType && this.reportResourceId) {
        this.findLabResultCodesFilteredToReport(this.reportSourceId, this.reportResourceType, this.reportResourceId)
          .subscribe((codes) => this.loadRowsForCodes(codes))
      } else {
        this.findLabResultCodesSortedByLatest().subscribe((data) => {
          this.loadRowsForCodes(data.map((item) => item.label))
        })
      }
    })
  }

  onGridReady(params: GridReadyEvent): void {
    this.gridApi = params.api
  }

  onPageSizeChanged(size: number): void {
    this.paginationPageSize = size
    this.gridApi?.paginationSetPageSize(size)
  }

  onRowClicked(event: RowClickedEvent): void {
    const data = event.data as LabRow
    if (!data) return

    data.isExpanded = !data.isExpanded
    if (!data.isExpanded) {
      data.glossaryOpen = false
    }

    this.gridApi?.resetRowHeights()
    this.gridApi?.redrawRows({ rowNodes: [event.node] })
  }

  private loadRowsForCodes(codes: string[]): void {
    this.loading = true
    this.getObservationsByCodes(codes).subscribe((info) => {
      this.loading = false
      const rows: LabRow[] = []

      for (const code of Object.keys(info.observationGroups)) {
        const sorted = [...(info.observationGroups[code] || [])].sort(
          (a, b) => a.sort_date > b.sort_date ? -1 : a.sort_date < b.sort_date ? 1 : 0
        )
        const models = sorted.map(ob => new ObservationModel(ob.resource_raw))
        const latest = models[0]

        // find panel via the most recent observation's source_resource_id
        const panel = sorted.reduce((found, obs) => {
          return found || this.panelMap.get(obs.source_resource_id) || ''
        }, '')

        // source: use the most recent observation's source_id
        const sourceId = sorted[0]?.source_id || ''
        const source = this.sourceMap.get(sourceId) || ''

        // flag: compare latest numeric value against reference range
        const numericValue = (latest?.value_model as any)?.value as number | undefined
        const refRange = latest?.reference_range
        let flag: 'H' | 'L' | '' = ''
        if (numericValue != null && refRange) {
          if (refRange.high_value != null && numericValue > refRange.high_value) flag = 'H'
          else if (refRange.low_value != null && numericValue < refRange.low_value) flag = 'L'
        }

        rows.push({
          code,
          name: info.observationGroupTitles[code] || code,
          panel: panel ? this.toTitleCase(panel) : '',
          result: latest?.value_model ? latest.value_model.display() : '—',
          date: latest?.effective_date ? new Date(latest.effective_date) : null,
          models,
          source,
          flag,
        })
      }

      rows.sort((a, b) => {
        if (!a.date && !b.date) return 0
        if (!a.date) return 1
        if (!b.date) return -1
        return b.date.getTime() - a.date.getTime()
      })

      this.rowData = rows
      this.isEmptyReport = rows.length === 0
    }, () => {
      this.loading = false
      this.isEmptyReport = true
    })
  }

  // get a list of all lab codes associated with a diagnostic report
  findLabResultCodesFilteredToReport(sourceId, resourceType, resourceId): Observable<any[]> {
    return this.fastenApi.getResources(resourceType, sourceId, resourceId)
      .pipe(
        mergeMap((diagnosticReports) => {
          const diagnosticReport = diagnosticReports?.[0]
          this.reportDisplayModel = fhirModelFactory(diagnosticReport.source_resource_type as ResourceType, diagnosticReport)
          const observationIds = fhirpath.evaluate(diagnosticReport.resource_raw, "DiagnosticReport.result.reference")
          const requests = observationIds.map(id => {
            const parts = id.split("/")
            return this.fastenApi.getResources(parts[0], diagnosticReport.source_id, parts[1])
          })
          return forkJoin(requests)
        }),
        map((results: ResourceFhir[][]) => {
          const allCodes = []
          for (const result of results) {
            for (const observation of result) {
              const code = fhirpath.evaluate(observation.resource_raw, "Observation.code.coding.where(system='http://loinc.org').first().code")[0]
              allCodes.push('http://loinc.org|' + code)
            }
          }
          return allCodes
        })
      )
  }

  // get a list of all unique lab codes ordered by latest date
  findLabResultCodesSortedByLatest(): Observable<LabResultCodeByDate[]> {
    return this.fastenApi.queryResources({
      select: [],
      from: "Observation",
      where: { "code": "http://loinc.org|,urn:oid:2.16.840.1.113883.6.1|" },
      aggregations: {
        order_by: { field: "sort_date", fn: "max" },
        group_by: { field: "code" }
      }
    }).pipe(map((response: ResponseWrapper) => response.data as LabResultCodeByDate[]))
  }

  // get the last 10 diagnostic reports for the dropdown
  populateReports() {
    return this.fastenApi.queryResources({
      select: ["*"],
      from: "DiagnosticReport",
      where: { "category": "http://terminology.hl7.org/CodeSystem/v2-0074|LAB" },
      limit: 10,
    }).subscribe(results => {
      this.diagnosticReports = results.data
    })
  }

  // build a map from observation source_resource_id → panel name using DiagnosticReport links
  private buildPanelMap(): Observable<void> {
    return this.fastenApi.queryResources({
      select: ['*'],
      from: 'DiagnosticReport',
      where: { 'category': 'http://terminology.hl7.org/CodeSystem/v2-0074|LAB' },
      limit: 500,
    }).pipe(
      map((response: ResponseWrapper) => {
        const map = new Map<string, string>()
        for (const dr of (response.data || [])) {
          const panelName = fhirpath.evaluate(dr.resource_raw, 'DiagnosticReport.code.text')[0]
            || fhirpath.evaluate(dr.resource_raw, 'DiagnosticReport.code.coding.first().display')[0]
          if (!panelName) continue
          const refs: string[] = fhirpath.evaluate(dr.resource_raw, 'DiagnosticReport.result.reference')
          for (const ref of refs) {
            const obsId = ref.split('/').pop()
            if (obsId && !map.has(obsId)) map.set(obsId, panelName)
          }
        }
        this.panelMap = map
      })
    )
  }

  // build a map from source_id → human-readable name using the Source display or brand_id
  private buildSourceMap(): Observable<void> {
    return this.fastenApi.getSources().pipe(
      map((sources: Source[]) => {
        const map = new Map<string, string>()
        for (const s of (sources || [])) {
          const name = s.display || (s.brand_id ? this.toTitleCase(s.brand_id.replace(/-/g, ' ')) : '')
          if (s.id && name) map.set(s.id, name)
        }
        this.sourceMap = map
      })
    )
  }

  // Bound handler passed to report-header's [customPdfExport]
  labsPdfExport = () => this.exportFilteredPdf()

  exportFilteredPdf(): void {
    if (!this.gridApi) return

    // Collect only data rows that survive the current filter
    const rows: LabRow[] = []
    this.gridApi.forEachNodeAfterFilter(node => {
      if (node.data) rows.push(node.data as LabRow)
    })

    const doc = new jsPDF({ orientation: 'landscape' })

    // Title
    doc.setFontSize(16)
    doc.text('Lab Results', 14, 16)
    doc.setFontSize(10)
    doc.setTextColor(120)
    const filterActive = rows.length < this.rowData.length
    doc.text(
      filterActive ? `Filtered: ${rows.length} of ${this.rowData.length} labs` : `${rows.length} labs`,
      14, 22
    )
    doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, 28)

    autoTable(doc, {
      startY: 34,
      head: [['Lab Name', 'Panel', 'Result', 'Source', 'Flag', 'Date']],
      body: rows.map(r => [
        r.name,
        r.panel || '—',
        r.result || '—',
        r.source || '—',
        r.flag || '',
        r.date ? new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
      ]),
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 55 }, 2: { cellWidth: 40 }, 3: { cellWidth: 45 }, 4: { cellWidth: 15 } }
    })

    doc.save(`lab-results${filterActive ? '-filtered' : ''}.pdf`)
  }

  private toTitleCase(str: string): string {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }

  // get all observations matching a set of codes
  private getObservationsByCodes(codes: string[]): Observable<ObservationGroupInfo> {
    return this.fastenApi.queryResources({
      select: [],
      from: "Observation",
      where: { "code": codes.join(",") }
    }).pipe(
      map((response: ResponseWrapper) => {
        const observationGroups: ObservationGroup = {}
        const observationGroupTitles: { [key: string]: string } = {}

        for (const observation of response.data) {
          const code = fhirpath.evaluate(observation.resource_raw, "Observation.code.coding.where(system='http://loinc.org').first().code")[0]
          observationGroups[code] = observationGroups[code] || []
          observationGroups[code].push(observation)

          if (!observationGroupTitles[code]) {
            let title = fhirpath.evaluate(observation.resource_raw, "Observation.code.coding.where(system='http://loinc.org').first().display")[0]
            if (!title) title = fhirpath.evaluate(observation.resource_raw, "Observation.code.coding.where(display.exists()).first().display")[0]
            if (!title) title = fhirpath.evaluate(observation.resource_raw, "Observation.code.text")[0]
            observationGroupTitles[code] = title
          }
        }

        return { observationGroups, observationGroupTitles }
      })
    )
  }
}
