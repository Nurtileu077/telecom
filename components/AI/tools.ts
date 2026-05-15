// Tool schema shared between the API route and the client-side executor.
// Each Claude tool maps to a useNetwork operation that mutates network state.

import type { CableType } from '@/types/network';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const AI_TOOLS: ToolDef[] = [
  {
    name: 'add_subscriber',
    description:
      'Add a subscriber (ONT endpoint) at the given coordinates. The system will automatically attach it to the nearest existing ORK and route a drop cable.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude in decimal degrees' },
        lon: { type: 'number', description: 'Longitude in decimal degrees' },
        desc: { type: 'string', description: 'Address or description (optional)' },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'add_olt',
    description:
      'Place a new OLT (узел связи / optical line terminal) at the given coordinates in the given district.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lon: { type: 'number' },
        district: { type: 'string', description: 'Name of the district this OLT serves' },
      },
      required: ['lat', 'lon', 'district'],
    },
  },
  {
    name: 'add_tb',
    description: 'Place a transit junction (Муфта МТОК) at the given coordinates. It joins the nearest OLT.',
    input_schema: {
      type: 'object',
      properties: { lat: { type: 'number' }, lon: { type: 'number' } },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'add_ork',
    description: 'Place an ORK (распределительный бокс) at the given coordinates. It joins the nearest TB.',
    input_schema: {
      type: 'object',
      properties: { lat: { type: 'number' }, lon: { type: 'number' } },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'connect_cable',
    description:
      'Draw a cable along roads between two existing entities (OLT/TB/ORK/subscriber). The route is computed via OSRM. Cable type is inferred unless specified.',
    input_schema: {
      type: 'object',
      properties: {
        from_id: { type: 'string', description: 'Source entity id (e.g. OLT-Turkist, Бокс-Turk-3, sub-12)' },
        to_id: { type: 'string', description: 'Target entity id' },
        type: {
          type: 'string',
          enum: ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16', 'ОК-24', 'ОК-32', 'ОК-48'],
          description: 'Optional cable type override',
        },
      },
      required: ['from_id', 'to_id'],
    },
  },
  {
    name: 'reconsolidate',
    description: 'Re-run cable consolidation — merge parallel cables on shared roads and place junction joints where they diverge.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'fly_to',
    description: 'Pan and zoom the map to the given coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lon: { type: 'number' },
        zoom: { type: 'number', description: 'Optional zoom level 1-19, default 16' },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'list_entities',
    description:
      'List entities of a given kind across the whole project, returning ids + coords + descriptions. Use this BEFORE add_/connect_ tools when you need to know what is on the map.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['olt', 'tb', 'ork', 'sub'] },
        limit: { type: 'number', description: 'Max entities to return (default 50)' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'find_entity',
    description: 'Search entities by id substring or description substring (case-insensitive).',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'delete_entity',
    description: 'Delete a subscriber by id. (Currently subs only — OLT/TB/ORK deletion needs explicit confirmation.)',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'inspect_cable',
    description:
      'Read everything about one cable: type, fibers, endpoints, length, full coord path, OSRM-routed flag. Use this when the user asks WHY a cable looks wrong or WHERE it goes.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'cable-... id' } },
      required: ['id'],
    },
  },
  {
    name: 'cables_near',
    description:
      'List cables whose path passes within `radius_m` metres of the given point. Returns id, type, length, endpoints, routed flag.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lon: { type: 'number' },
        radius_m: { type: 'number', description: 'Search radius in metres, default 50' },
        limit: { type: 'number', description: 'Max cables to return, default 20' },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'routing_analysis',
    description:
      'Aggregate routing-quality stats across all cables: total/routed counts, % OSRM-routed by type, average length, longest straight (non-routed) cables. Run this to find places that look bad.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_validation_issues',
    description:
      'Get the project validation issues — disconnected entities, over-capacity ORKs, missing fibers, oversize cables, etc.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'inspect_entity',
    description:
      'Read full info about a specific OLT / TB / ORK / subscriber by id, including its children (TBs under OLT, ORKs under TB, subs under ORK).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_cable',
    description:
      'Delete a single cable by id.  Use this to remove phantom long cables / cables connecting different districts / loops that the user wants gone.  Does NOT touch endpoints.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'rebuild_network',
    description:
      'Completely rebuild the network from the current subscriber list + OLT overrides. Use ONLY when the user explicitly asks for a fresh rebuild — manual cable edits / drag-drop reassignments will be lost.',
    input_schema: { type: 'object', properties: {} },
  },
];

export type AITool =
  | { name: 'add_subscriber'; input: { lat: number; lon: number; desc?: string } }
  | { name: 'add_olt'; input: { lat: number; lon: number; district: string } }
  | { name: 'add_tb'; input: { lat: number; lon: number } }
  | { name: 'add_ork'; input: { lat: number; lon: number } }
  | { name: 'connect_cable'; input: { from_id: string; to_id: string; type?: CableType } }
  | { name: 'reconsolidate'; input: Record<string, never> }
  | { name: 'fly_to'; input: { lat: number; lon: number; zoom?: number } }
  | { name: 'list_entities'; input: { kind: 'olt' | 'tb' | 'ork' | 'sub'; limit?: number } }
  | { name: 'find_entity'; input: { query: string } }
  | { name: 'delete_entity'; input: { id: string } }
  | { name: 'inspect_cable'; input: { id: string } }
  | { name: 'cables_near'; input: { lat: number; lon: number; radius_m?: number; limit?: number } }
  | { name: 'routing_analysis'; input: Record<string, never> }
  | { name: 'get_validation_issues'; input: Record<string, never> }
  | { name: 'inspect_entity'; input: { id: string } }
  | { name: 'delete_cable'; input: { id: string } }
  | { name: 'rebuild_network'; input: Record<string, never> };
