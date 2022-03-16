///!!!!!!!!!!!DELETE THIS AFTER JOININF WITH WORKDLOWSTEP PROVIDER
import { h, Component } from 'preact'
import {
  createMemoryHistory,
  createBrowserHistory,
  History,
  LocationListener,
  MemoryHistory,
} from 'history'

import { buildStepFinder, findFirstIndex } from '~utils/steps'
import { buildComponentsList } from '../Router/StepComponentMap'
import StepsRouter from '../Router/StepsRouter'
import { formatStep } from '../..'

import { trackException } from '../../Tracker'

import type { ParsedError, ErrorCallback } from '~types/api'

import type { WorkflowResponse } from './utils/WorkflowTypes' //remove after refactoring router
import type {
  ExtendedStepTypes,
  FlowVariants,
  FormattedError,
} from '~types/commons'
import type { CaptureKeys } from '~types/redux'
import type {
  ComponentStep,
  ChangeFlowProp,
  HistoryRouterProps,
  HistoryLocationState,
  StepperState,
} from '~types/routers'
import type { SdkResponse } from '~types/sdk'
import type { DocumentTypes, StepTypes } from '~types/steps'
import { CancelFunc, poller, PollFunc, workflowEngine } from '.'

type State = {
  initialStep: number
} & HistoryLocationState &
  StepperState

export default class WorkflowHistoryRouter extends Component<
  HistoryRouterProps,
  State
> {
  private history:
    | MemoryHistory<HistoryLocationState>
    | History<HistoryLocationState>
  private unlisten: () => void

  constructor(props: HistoryRouterProps) {
    super(props)
    const componentsList = this.getComponentsList('captureSteps', this.props)

    const stepIndex =
      this.props.stepIndexType === 'client'
        ? findFirstIndex(componentsList, this.props.step || 0)
        : this.props.step || 0

    this.state = {
      flow: 'captureSteps',
      step: stepIndex,
      initialStep: stepIndex,
      // workflow stepper
      loadingStep: false,
      steps: this.props.steps,
      taskId: null,
      completed: false,
      serviceError: null,
      personalData: {},
      docData: [],
    }
    this.history = this.props.options.useMemoryHistory
      ? createMemoryHistory()
      : createBrowserHistory()
    this.unlisten = this.history.listen(this.onHistoryChange)
    this.setStepIndex(this.state.step, this.state.flow)
  }

  setDocData = (data: unknown, callback?: () => void): void => {
    this.setState(
      {
        ...this.state,
        docData: [...this.state.docData, data],
      },
      () => {
        callback?.() // this is possible next step call, but we need to make sure doc data is set
      }
    )
  }

  clearDocData = (): void => {
    this.setState({
      ...this.state,
      docData: [],
    })
  }

  setPersonalData = (data: any, callback?: () => void): void => {
    this.setState(
      {
        ...this.state,
        personalData: {
          ...this.state.personalData,
          ...data,
        },
      },
      () => {
        callback?.() // this is possible next step call, but we need to make sure personal data is set
      }
    )
  }

  clearPersonalData = (): void => {
    this.setState({
      ...this.state,
      personalData: {},
    })
  }

  onHistoryChange: LocationListener<HistoryLocationState> = ({
    state: historyState,
  }) => {
    this.setState({ ...historyState })
  }

  componentWillUnmount(): void {
    this.unlisten()
  }

  getStepType = (step: number): ExtendedStepTypes | undefined => {
    const componentList = this.getComponentsList()
    return componentList[step] ? componentList[step].step.type : undefined
  }

  initialStep = (): boolean =>
    this.state.initialStep === this.state.step &&
    this.state.flow === 'captureSteps'

  changeFlowTo: ChangeFlowProp = (
    newFlow,
    newStep = 0,
    excludeStepFromHistory = false
  ) => {
    const { onFlowChange } = this.props
    const { step: currentStep, steps } = this.state
    const { flow: previousFlow, step: previousUserStepIndex } = this.state
    if (previousFlow === newFlow) return
    const previousUserStep = this.getComponentsList()[previousUserStepIndex]
    onFlowChange &&
      onFlowChange(
        newFlow,
        newStep,
        previousFlow,
        {
          userStepIndex: previousUserStepIndex,
          clientStepIndex: previousUserStep.stepIndex,
          clientStep: previousUserStep,
        },
        steps
      )
    this.setStepIndex(newStep, newFlow, excludeStepFromHistory)
  }

  nextWorkflowStep = async (): Promise<void> => {
    console.log('next step requested')

    const { options, urls } = this.props
    const { workflowRunId, token } = options
    const { step: currentStep, taskId, completed } = this.state
    const componentsList = this.getComponentsList()
    const newStepIndex = currentStep + 1

    const workflowServiceUrl = `${urls.onfido_api_url}/v4`

    // in case a step is consisting of multiple components, just continue the flow
    if (componentsList.length !== newStepIndex) {
      console.log('continue workflow step: ', componentsList[newStepIndex])
      this.setStepIndex(newStepIndex)
      return
    }

    if (completed) return // that's it, we're done

    if (!workflowRunId) {
      this.setState((state) => ({
        ...state,
        serviceError: 'Workflow run ID is not set.',
      }))
      return
    }

    console.log(`workflow (instance) ID: ${workflowRunId}`)

    // otherwise display a loading screen
    this.setState((state) => ({ ...state, loadingStep: true }))

    // if step has started - complete it
    if (taskId) {
      try {
        await workflowEngine({
          token,
          workflowServiceUrl,
          workflowRunId,
        }).completeWorkflow(taskId, this.state.personalData, this.state.docData)
        this.clearPersonalData()
        this.clearDocData()
      } catch {
        this.setState((state) => ({
          ...state,
          serviceError: 'Could not complete workflow task.',
        }))
        return
      }
      this.setState((state) => ({ ...state, taskId: null }))
    }

    poller(async (poll: PollFunc) => {
      if (!workflowRunId) return

      let workflow: WorkflowResponse | undefined

      try {
        workflow = await workflowEngine({
          workflowRunId,
          token,
          workflowServiceUrl,
        }).getWorkflow()
      } catch {
        this.setState((state) => ({
          ...state,
          serviceError: 'Could not retrieve workflow task.',
        }))
      }

      if (!workflow) {
        this.setState((state) => ({
          ...state,
          serviceError: 'Could not retrieve workflow task.',
        }))
        return
      }

      console.log('workflow loaded: ', workflow)

      if (
        workflow.finished ||
        workflow.has_remaining_interactive_tasks === false
      ) {
        this.setState(
          (state) => ({
            ...state,
            flow: 'captureSteps',
            loadingStep: false,
            taskId: workflow?.task_id,
            //@ts-ignore
            steps: [
              formatStep(
                workflowEngine({
                  workflowRunId,
                  token,
                  workflowServiceUrl,
                }).getOutcomeStep(workflow)
              ),
            ],
            step: 0, // start again from 1st step,
            completed: true, // indicate that we have completed the workflow
          }),
          () => {
            this.triggerOnComplete()
            console.log('starting workflow step: ', this.getComponentsList()[0])
            this.setStepIndex(0)
          }
        )
        return
      }

      this.setState((state) => ({
        ...state,
      }))

      // continue polling until interactive task is found
      if (workflow?.task_type !== 'INTERACTIVE') {
        console.log(`Non interactive workflow task, keep polling`)
        poll(1500)
        return
      }

      const step = workflowEngine({
        workflowRunId,
        token,
        workflowServiceUrl,
      }).getWorkFlowStep(workflow.task_def_id, workflow.config) as any
      if (!step) {
        this.setState((state) => ({
          ...state,
          serviceError: 'Task is currently not supported.',
        }))

        return
      }

      console.log('step before format', step)

      console.log('step after format', [formatStep(step)])

      this.setState(
        (state) => ({
          ...state,
          flow: 'captureSteps', //to make sure to reset incase of cross device
          loadingStep: false,
          steps: [formatStep(step)],
          taskId: workflow?.task_id,
          step: 0, // start again from 1st step
        }),
        () => {
          console.log('starting workflow step: ', this.getComponentsList()[0])
          this.setStepIndex(0)
        }
      )
    })
  }

  triggerOnComplete = (): void => {
    const { captures } = this.props

    const expectedCaptureKeys: CaptureKeys[] = [
      'document_front',
      'document_back',
      'face',
      'data',
    ]
    const data: SdkResponse = Object.entries(captures)
      .filter(([key, value]) => key !== 'takesHistory' && value != null)
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value?.metadata }), {})

    const keysWithMissingData: Array<string> = []

    expectedCaptureKeys.forEach((key) => {
      if (key in data && data[key] === undefined) {
        keysWithMissingData.push(key)
      }
    })

    if (keysWithMissingData.length) {
      this.triggerOnError({
        response: {
          type: 'exception',
          message: `The following keys have missing data: ${keysWithMissingData}`,
        },
      })
      return
    }

    this.props.options.events?.emit('complete', data)
  }

  formattedError = ({ response, status }: ParsedError): FormattedError => {
    const errorResponse = response.error || response || {}

    const isExpiredTokenError =
      status === 401 && errorResponse.type === 'expired_token'
    const type = isExpiredTokenError ? 'expired_token' : 'exception'
    // `/validate_document` returns a string only. Example: "Token has expired."
    // Ticket in backlog to update all APIs to use signature similar to main Onfido API
    const message = errorResponse.message || response.message || 'Unknown error'
    return { type, message }
  }

  triggerOnError: ErrorCallback = ({ response, status }) => {
    if (status === 0) {
      return
    }

    const error = this.formattedError({ response, status })
    const { type, message } = error
    this.props.options.events?.emit('error', { type, message })
    trackException(`${type} - ${message}`)
  }

  previousStep = (): void => {
    const { step: currentStep } = this.state
    this.setStepIndex(currentStep - 1)
  }

  back = (): void => {
    this.history.goBack()
  }

  setStepIndex = (
    newStepIndex: number,
    newFlow?: FlowVariants,
    excludeStepFromHistory?: boolean
  ): void => {
    const { flow: currentFlow } = this.state
    const newState = {
      step: newStepIndex,
      flow: newFlow || currentFlow,
    }
    if (excludeStepFromHistory) {
      this.setState(newState)
    } else {
      const path = `${location.pathname}${location.search}${location.hash}`
      this.history.push(path, newState)
    }
  }

  getComponentsList = (
    flow?: FlowVariants,
    props: HistoryRouterProps = this.props
  ): ComponentStep[] => {
    const {
      documentType,
      deviceHasCameraSupport,
      options: { mobileFlow },
    } = props

    const steps = this.state?.steps || props.steps

    if (!steps) {
      throw new Error('steps not provided')
    }

    return buildComponentsList({
      flow: flow || this.state.flow,
      documentType,
      steps,
      mobileFlow,
      deviceHasCameraSupport,
    })
  }

  getDocumentType = (): DocumentTypes | undefined => {
    const { documentType } = this.props
    const { steps } = this.state
    const findStep = buildStepFinder(steps)
    const documentStep = findStep('document')
    const documentTypes = documentStep?.options?.documentTypes || {}
    const enabledDocuments = Object.keys(documentTypes) as DocumentTypes[]
    const isSinglePreselectedDocument = enabledDocuments.length === 1

    if (isSinglePreselectedDocument && !documentType) {
      return enabledDocuments[0]
    }

    return documentType
  }

  render(): h.JSX.Element {
    const documentType = this.getDocumentType()
    const { serviceError } = this.state

    if (serviceError) {
      return (
        <div>
          <p>There was a server error!</p>
          <p>{serviceError}</p>
          <p>Please try reloading the app, and try again.</p>
        </div>
      )
    }

    return (
      <StepsRouter
        {...this.props}
        back={this.back}
        changeFlowTo={this.changeFlowTo}
        componentsList={this.getComponentsList()}
        disableNavigation={true}
        documentType={documentType}
        nextStep={this.nextWorkflowStep}
        previousStep={this.previousStep}
        step={this.state.step}
        triggerOnError={this.triggerOnError}
        isLoadingStep={this.state.loadingStep}
        setPersonalData={this.setPersonalData}
        setDocData={this.setDocData}
      />
    )
  }
}
