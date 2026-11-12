{{- define "probaline.name" -}}{{ .Release.Name | trunc 50 | trimSuffix "-" }}{{- end -}}
{{- define "probaline.labels" -}}
app.kubernetes.io/name: probaline
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "probaline.selector" -}}
app.kubernetes.io/name: probaline
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "probaline.secretName" -}}{{ .Values.existingSecret | default (printf "%s-settings" (include "probaline.name" .)) }}{{- end -}}
{{- define "probaline.host" -}}{{ .Values.publicUrl | trimPrefix "https://" | trimPrefix "http://" | trimSuffix "/" }}{{- end -}}
