// Probaline collector for Azure: a scheduled Container Apps job that reads diagnostic logs from a storage
// account you already have, keeps AI matches only, and writes results and the report to a new storage
// account. It signs in with its own managed identity: read-only on the logs, write on the results.
// Nothing leaves your subscription.
//
//   az deployment group create -g <resource-group> -f collector.bicep \
//     -p logStorageAccountName=<account with insights-logs-* containers> image=<registry>/probaline-collector:<tag>
//
// The log storage account must be in the same resource group (otherwise grant the job's identity
// "Storage Blob Data Reader" on it yourself; the output gives the identity's principal ID).

@description('Storage account where diagnostic settings write the logs (insights-logs-* containers).')
param logStorageAccountName string

@description('Containers to read. Defaults cover Azure Firewall and Azure OpenAI request logs.')
param logContainers array = [
  'insights-logs-azfwapplicationrule'
  'insights-logs-azfwdnsquery'
  'insights-logs-azurefirewallapplicationrule'
  'insights-logs-azurefirewalldnsproxy'
  'insights-logs-requestresponse'
]

@description('Collector container image, e.g. myregistry.azurecr.io/probaline-collector:0.1.0')
param image string

@description('Name of an Azure Container Registry in this resource group to pull the image from (optional).')
param registryName string = ''

@description('New storage account for results (3–24 lower-case letters and digits).')
param resultsStorageAccountName string = 'probaline${uniqueString(resourceGroup().id)}'

@description('How often the job runs (cron, UTC). Default: every hour at :15.')
param schedule string = '15 * * * *'

@description('Callers to leave out entirely: known-good callers that aren\'t AI use (comma-separated).')
param ignore string = ''

@description('The Probaline gateway and connector, e.g. ip:203.0.113.4 (comma-separated). Counted as through Probaline.')
param gateway string = ''

@description('Company name shown on the report.')
param company string = ''

param location string = resourceGroup().location

var blobDataReader = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
var blobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource logs 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: logStorageAccountName
}

resource results 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: resultsStorageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource resultsBlob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: results
  name: 'default'
}

resource resultsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: resultsBlob
  name: 'probaline-results'
  properties: { publicAccess: 'None' }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'probaline-collector-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'probaline-collector'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: 'probaline-collector'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: { cronExpression: schedule, parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 3600
      replicaRetryLimit: 1
      registries: empty(registryName) ? [] : [ { server: '${registryName}.azurecr.io', identity: 'system' } ]
    }
    template: {
      containers: [
        {
          name: 'collector'
          image: image
          command: [ 'node', 'dist/cli.js', 'cloud-job' ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'CLOUD', value: 'azure' }
            { name: 'LOG_ACCOUNT_URL', value: logs.properties.primaryEndpoints.blob }
            { name: 'LOG_CONTAINERS', value: join(logContainers, ',') }
            { name: 'RESULTS_ACCOUNT_URL', value: results.properties.primaryEndpoints.blob }
            { name: 'RESULTS_CONTAINER', value: resultsContainer.name }
            { name: 'IGNORE', value: ignore }
            { name: 'GATEWAY', value: gateway }
            { name: 'COMPANY', value: company }
          ]
        }
      ]
    }
  }
}

resource readLogs 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(logs.id, job.id, blobDataReader)
  scope: logs
  properties: { principalId: job.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataReader) }
}

resource writeResults 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(results.id, job.id, blobDataContributor)
  scope: results
  properties: { principalId: job.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor) }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = if (!empty(registryName)) {
  name: empty(registryName) ? 'unused' : registryName
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(registryName)) {
  name: guid(resourceGroup().id, job.id, acrPull)
  scope: registry
  properties: { principalId: job.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull) }
}

output jobName string = job.name
output jobPrincipalId string = job.identity.principalId
output reportUrl string = '${results.properties.primaryEndpoints.blob}probaline-results/reports/latest.html'
output runNow string = 'az containerapp job start -g ${resourceGroup().name} -n ${job.name}'
