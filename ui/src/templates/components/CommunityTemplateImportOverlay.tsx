import React, {PureComponent} from 'react'
import {withRouter, RouteComponentProps} from 'react-router-dom'
import {connect, ConnectedProps} from 'react-redux'

// Components
import {CommunityTemplateOverlay} from 'src/templates/components/CommunityTemplateOverlay'

// Actions
import {setStagedCommunityTemplate} from 'src/templates/actions/creators'
import {createTemplate, fetchAndSetStacks} from 'src/templates/actions/thunks'
import {notify} from 'src/shared/actions/notifications'

import {getTotalResourceCount} from 'src/templates/selectors'

// Types
import {AppState, Organization, ResourceType} from 'src/types'
import {ComponentStatus} from '@influxdata/clockface'

// Utils
import {getByID} from 'src/resources/selectors'
import {getGithubUrlFromTemplateDetails} from 'src/templates/utils'
import {reportError} from 'src/shared/utils/errors'

import {
  installTemplate,
  reviewTemplate,
  updateStackName,
} from 'src/templates/api'

import {
  communityTemplateInstallFailed,
  communityTemplateInstallSucceeded,
  communityTemplateRenameFailed,
} from 'src/shared/copy/notifications'

import {event} from 'src/cloud/utils/reporting'

interface State {
  status: ComponentStatus
}

type ReduxProps = ConnectedProps<typeof connector>
type RouterProps = RouteComponentProps<{
  directory: string
  orgID: string
  templateName: string
  templateExtension: string
}>
type Props = ReduxProps & RouterProps

class UnconnectedTemplateImportOverlay extends PureComponent<Props> {
  public state: State = {
    status: ComponentStatus.Default,
  }

  public componentDidMount() {
    const {directory, org, templateExtension, templateName} = this.props
    this.reviewTemplateResources(
      org.id,
      directory,
      templateName,
      templateExtension
    )
  }

  public render() {
    return (
      <CommunityTemplateOverlay
        onDismissOverlay={this.onDismiss}
        onInstall={this.handleInstallTemplate}
        resourceCount={this.props.resourceCount}
        status={this.state.status}
        templateName={this.props.templateName}
        updateStatus={this.updateOverlayStatus}
      />
    )
  }

  private reviewTemplateResources = async (
    orgID,
    directory,
    templateName,
    templateExtension
  ) => {
    const yamlLocation = getGithubUrlFromTemplateDetails(
      directory,
      templateName,
      templateExtension
    )

    try {
      const summary = await reviewTemplate(orgID, yamlLocation)

      this.props.setStagedCommunityTemplate(summary)
      return summary
    } catch (err) {
      this.props.notify(communityTemplateInstallFailed(err.message))
      reportError(err, {
        name: 'The community template fetch for preview failed',
      })
    }
  }

  private onDismiss = () => {
    const {history} = this.props

    history.goBack()
  }

  private updateOverlayStatus = (status: ComponentStatus) =>
    this.setState(() => ({status}))

  private handleInstallTemplate = async () => {
    const {directory, org, templateExtension, templateName} = this.props

    const yamlLocation = getGithubUrlFromTemplateDetails(
      directory,
      templateName,
      templateExtension
    )

    let summary
    try {
      summary = await installTemplate(
        org.id,
        yamlLocation,
        this.props.resourcesToSkip
      )
    } catch (err) {
      this.props.notify(communityTemplateInstallFailed(err.message))
      reportError(err, {name: 'Failed to install community template'})
    }

    try {
      await updateStackName(summary.stackID, templateName)

      event('template_install', {templateName: templateName})

      this.props.notify(communityTemplateInstallSucceeded(templateName))
    } catch (err) {
      this.props.notify(communityTemplateRenameFailed())
      reportError(err, {name: 'The community template rename failed'})
    } finally {
      this.props.fetchAndSetStacks(org.id)
      this.onDismiss()
    }
  }
}

const mstp = (state: AppState, props: RouterProps) => {
  const org = getByID<Organization>(
    state,
    ResourceType.Orgs,
    props.match.params.orgID
  )

  return {
    org,
    directory: props.match.params.directory,
    templateName: props.match.params.templateName,
    templateExtension: props.match.params.templateExtension,
    flags: state.flags.original,
    resourceCount: getTotalResourceCount(
      state.resources.templates.stagedCommunityTemplate.summary
    ),
    resourcesToSkip:
      state.resources.templates.stagedCommunityTemplate.resourcesToSkip,
  }
}

const mdtp = {
  createTemplate,
  notify,
  setStagedCommunityTemplate,
  fetchAndSetStacks,
}

const connector = connect(mstp, mdtp)

export const CommunityTemplateImportOverlay = connector(
  withRouter(UnconnectedTemplateImportOverlay)
)
