/*
   This file is part of Astarte.

   Copyright 2018 Ispirata Srl

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';

const REQUEST_SAMPLE_LIMIT = 5000;

export default class AstarteDatasource {
    id: number;
    name: string;
    server: string;
    realm: string;
    token: string;

    /** @ngInject */
    constructor(instanceSettings, private backendSrv, private templateSrv, private $q) {
        this.name = instanceSettings.name;
        this.id = instanceSettings.id;
        this.server = instanceSettings.jsonData.server;
        this.realm = instanceSettings.jsonData.realm;
        this.token = instanceSettings.jsonData.token;
    }

    baseQueryPath() {
        return `${this.server}/${this.realm}`;
    }

    isBase64Id(deviceId) {
        return /^[A-Za-z0-9_\-]{22}$/g.test(deviceId);
    }

    buildInterfacesQuery(deviceId) {
        let query: string = this.baseQueryPath();

        if (this.isBase64Id(deviceId)) {
            query += `/devices/${deviceId}/interfaces`;
        } else {
            query += `/devices-by-alias/${deviceId}/interfaces`;
        }

        return encodeURI(query);
    }

    buildEndpointQuery(deviceId, interfaceName, path, since, to, limit) {
        let query: string = this.baseQueryPath();

        if (this.isBase64Id(deviceId)) {
            query += `/devices/${deviceId}`;
        } else {
            query += `/devices-by-alias/${deviceId}`;
        }

        query += `/interfaces/${interfaceName}`;

        if (path) {
            query += `/${path}`;
        }
        query += `?format=disjoint_tables&keep_milliseconds=true`;
        if (since) {
            query += `&since=${since.toISOString()}`;
        }
        if (to) {
            query += `&to=${to.toISOString()}`;
        }
        if (limit > 0) {
            query += `&limit=${limit}`;
        }

        return encodeURI(query);
    }

    async getAllSamples(params) {
        const {
            deviceId,
            interfaceName,
            path,
            since,
            to,
            label,
        } = params;

        const samples = {
            label,
            data: {},
        };

        let hasMore = true;
        let startingTimestamp = since;

        while (hasMore) {
            const query = this.buildEndpointQuery(deviceId, interfaceName, path, startingTimestamp, to, REQUEST_SAMPLE_LIMIT);
            const response = await this.backendSrv.datasourceRequest({
                url: query,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.status == 200) {
                let series = response.data.data;
                for (let key in series) {
                    const timeSeries = series[key];
                    if (timeSeries.length && typeof timeSeries[0][0] === "number") {
                        const prevData = samples.data[key] || [];
                        samples.data[key] = prevData.concat(timeSeries);
                    }
                    if (timeSeries.length < REQUEST_SAMPLE_LIMIT) {
                        hasMore = false;
                    } else {
                        startingTimestamp = new Date(timeSeries[timeSeries.length - 1][1]);
                    }
                }
            } else {
                hasMore = false;
            }
        }

        return samples;
    }

    runAstarteQuery(query) {
        return this.backendSrv.datasourceRequest({
            url: query,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${this.token}` }
        });
    }

    query(options) {
        let from: Date = options.range.from._d;
        let to: Date = options.range.to._d;
        let fromTime: number = from.getTime();
        let toTime: number = to.getTime();

        let interval: number = options.intervalMs;
        let promises: any[] = [];
        let query: string;

        for (let entry of options.targets) {

            if (entry.hide) {
                continue;
            }

            if (entry.deviceid && entry.interface) {
                const label = this.isBase64Id(entry.deviceid) ? entry.deviceid.substring(0, 5) : entry.deviceid;
                promises.push(this.getAllSamples({
                    deviceId: entry.deviceid,
                    interfaceName: entry.interface,
                    path: entry.path,
                    since: from,
                    to,
                    label,
                }));
            }
        }

        if (promises.length <= 0) {
            return this.$q.when({ data: [] });
        }

        let allPromises: any;
        allPromises = this.$q.all(promises).then(results => {
            let result: any = { data : [] };
            _.forEach(results, function(response) {
                for (const key in response.data) {
                    result.data.push({
                        target: `${key}[${response.label}]`,
                        datapoints: response.data[key],
                    });
                }
            });
            return result;
        });

        return allPromises;
    }

    annotationQuery(options) {
        throw new Error("Annotation Support not implemented yet.");
    }

    metricFindQuery(query: string) {
        throw new Error("Template Variable Support not implemented yet.");
    }

    testDatasource() {
        return { status: "success", message: "Data source is working", title: "Success" };
    }
}
